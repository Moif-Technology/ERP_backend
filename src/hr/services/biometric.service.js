import crypto from 'crypto';
import { withTransaction } from '../../config/db.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as bioRepo from '../repositories/biometric.repository.js';

// Business logic for the biometric attendance bridge.
//
// Two callers with very different trust levels land here:
//   - the office push agent, authenticated by a device token (authenticateDevice)
//   - HR users in the ERP, authenticated by the normal staff session
//
// Every function therefore takes an already-resolved { companyId, branchId }
// rather than deriving it, so a device route can never accidentally read the
// tenant out of a request body.

const MAX_ROWS_PER_SYNC = 5000;
const STALE_JOB_MINUTES = 15;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function optionalText(v, max = 255) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function requirePositiveInt(v, fieldName) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) throw badRequest(`Valid ${fieldName} is required`);
  return n;
}

function parseDate(v, fieldName) {
  const s = optionalText(v, 10);
  if (!s || !DATE_RE.test(s)) throw badRequest(`${fieldName} must be YYYY-MM-DD`);
  if (Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw badRequest(`${fieldName} is not a real date`);
  return s;
}

function parseTime(v) {
  const s = optionalText(v, 8);
  if (!s) return null;
  if (!TIME_RE.test(s)) return null; // a malformed time is dropped, not fatal
  return s.length === 5 ? `${s}:00` : s;
}

function toDateOnly(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  return new Date(v).toISOString().slice(0, 10);
}

// ── Tenant resolution (staff session) ─────────────────
export async function resolveTenant(pool, authStaff, branchInput) {
  const companyId = Number(authStaff?.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid session company');
    err.status = 401;
    throw err;
  }
  const candidate = branchInput ?? authStaff?.branch_id;
  const branchId = Number(candidate);
  if (!Number.isFinite(branchId) || branchId < 1) throw badRequest('branchId is required');
  const ok = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!ok) throw badRequest('Invalid branch for this company');
  return { companyId, branchId };
}

// ── Device token auth ─────────────────────────────────
export function hashToken(plain) {
  return crypto.createHash('sha256').update(String(plain), 'utf8').digest('hex');
}

export function generateToken() {
  // 48 bytes -> 64 url-safe chars. Long enough that the endpoint needs no
  // rate limiting to resist guessing.
  return crypto.randomBytes(48).toString('base64url');
}

// Resolves a bearer secret to a tenant. Returns null for anything invalid, so
// the caller answers 401 without leaking which part was wrong.
export async function authenticateDevice(pool, authorizationHeader, ip) {
  const header = String(authorizationHeader || '');
  const m = header.match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  const token = await bioRepo.findTokenByHash(pool, hashToken(m[1]));
  if (!token || !token.isActive) return null;
  // Best-effort liveness stamp; a failure here must not fail the push.
  bioRepo.touchToken(pool, token.tokenId, ip).catch(() => {});
  return token;
}

export async function issueToken(pool, companyId, branchId, label) {
  const plain = generateToken();
  const { tokenId } = await withTransaction((client) => bioRepo.insertToken(client, {
    companyId, branchId, tokenHash: hashToken(plain), label: optionalText(label, 80),
  }));
  // The plaintext is returned exactly once - only its hash is stored.
  return { tokenId, token: plain };
}

export function listTokens(pool, companyId, branchId) {
  return bioRepo.listTokens(pool, companyId, branchId);
}

// ── The push endpoint ─────────────────────────────────
function normaliseRows(rawRows) {
  if (!Array.isArray(rawRows)) throw badRequest('rows must be an array');
  if (rawRows.length > MAX_ROWS_PER_SYNC) {
    throw badRequest(`rows exceeds the ${MAX_ROWS_PER_SYNC} row limit for one sync`);
  }
  const out = [];
  for (const r of rawRows) {
    const devicePin = optionalText(r?.pin ?? r?.devicePin, 64);
    if (!devicePin) continue; // a row with no PIN identifies nobody
    const workDate = optionalText(r?.date ?? r?.workDate, 10);
    if (!workDate || !DATE_RE.test(workDate)) continue;
    const hoursNum = Number(r?.hours);
    out.push({
      devicePin,
      deviceName: optionalText(r?.name ?? r?.deviceName, 120),
      workDate,
      firstIn: parseTime(r?.firstIn ?? r?.first_in),
      lastOut: parseTime(r?.lastOut ?? r?.last_out),
      hours: Number.isFinite(hoursNum) ? hoursNum : null,
      punches: Number.isFinite(Number(r?.punches)) ? Number(r.punches) : 0,
    });
  }
  return out;
}

/**
 * Applies one push from the office agent.
 *
 * Everything runs in a single transaction: either the whole batch lands or none
 * of it does, so a mid-batch crash cannot leave a job marked done with half its
 * days written.
 */
export async function applySync(pool, tenant, body) {
  const { companyId, branchId } = tenant;
  const deviceSn = optionalText(body?.deviceSn, 64);
  const jobId = body?.jobId != null ? requirePositiveInt(body.jobId, 'jobId') : null;
  const rows = normaliseRows(body?.rows);

  const result = await withTransaction(async (client) => {
    // Serialise pushes for this tenant: both daily_id and staging_id are
    // MAX+1 allocations, which race without it.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `hr.biometric_sync:${companyId}:${branchId}`,
    ]);

    const pins = [...new Set(rows.map((r) => r.devicePin))];
    const resolved = await bioRepo.resolvePins(client, companyId, branchId, pins);

    let nextStaging = await bioRepo.nextStagingId(client, companyId, branchId);
    let nextDaily = await bioRepo.nextDailyId(client, companyId, branchId);

    let matched = 0;
    let staged = 0;
    const unmatchedPins = new Set();

    for (const row of rows) {
      const employeeId = resolved.get(row.devicePin) ?? null;

      if (employeeId != null) {
        await bioRepo.upsertAttendanceFromDevice(client, {
          companyId, branchId,
          dailyId: nextDaily++,
          employeeId,
          workDate: row.workDate,
          firstIn: row.firstIn,
          lastOut: row.lastOut,
          devicePin: row.devicePin,
        });
        matched += 1;
      } else {
        staged += 1;
        unmatchedPins.add(row.devicePin);
      }

      // Every row is recorded, matched or not. This table is the audit trail
      // and the replay source, so nothing the device sent is ever discarded.
      await bioRepo.upsertStagingRow(client, {
        companyId, branchId,
        stagingId: nextStaging++,
        devicePin: row.devicePin,
        deviceName: row.deviceName,
        deviceSn,
        workDate: row.workDate,
        firstIn: row.firstIn,
        lastOut: row.lastOut,
        hours: row.hours,
        punches: row.punches,
        status: employeeId != null ? 'applied' : 'unmatched',
        employeeId,
        appliedAt: employeeId != null ? new Date() : null,
      });
    }

    if (tenant.tokenId != null) {
      await bioRepo.markTokenSync(client, tenant.tokenId, rows.length);
    }

    if (jobId != null) {
      await bioRepo.completeSyncJob(client, {
        companyId, branchId, jobId,
        status: 'done',
        rowsReceived: rows.length,
        rowsMatched: matched,
        rowsStaged: staged,
      });
    }

    return {
      received: rows.length,
      matched,
      staged,
      unmatchedPins: [...unmatchedPins],
    };
  });

  return result;
}

// Lets the agent report a failure instead of leaving the job stuck in 'claimed'
// until the staleness sweep releases it.
export async function failSyncJob(pool, tenant, jobId, message) {
  const id = requirePositiveInt(jobId, 'jobId');
  return withTransaction((client) => bioRepo.completeSyncJob(client, {
    companyId: tenant.companyId,
    branchId: tenant.branchId,
    jobId: id,
    status: 'failed',
    errorMessage: optionalText(message, 500),
  }));
}

// ── Job queue ─────────────────────────────────────────
export async function claimJobsForDevice(pool, tenant, limit) {
  const { companyId, branchId } = tenant;
  return withTransaction(async (client) => {
    // A job claimed by an agent that then died would never be retried.
    await bioRepo.releaseStaleJobs(client, companyId, branchId, STALE_JOB_MINUTES);
    return bioRepo.claimPendingJobs(client, companyId, branchId, Math.min(Number(limit) || 5, 20));
  });
}

export async function enqueueSyncJob(pool, authStaff, body) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, body?.branchId);
  const fromDate = parseDate(body?.fromDate, 'fromDate');
  const toDate = parseDate(body?.toDate, 'toDate');
  if (toDate < fromDate) throw badRequest('toDate must be on or after fromDate');

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `hr.attendance_sync_job:${companyId}:${branchId}`,
    ]);
    const jobId = await bioRepo.nextSyncJobId(client, companyId, branchId);
    return bioRepo.insertSyncJob(client, {
      companyId, branchId, jobId, fromDate, toDate,
      requestedBy: authStaff?.staff_id != null ? Number(authStaff.staff_id) : null,
    });
  });
}

export async function listSyncJobs(pool, authStaff, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  return bioRepo.listSyncJobs(pool, companyId, branchId, query?.limit);
}

// ── HR-facing views ───────────────────────────────────
export async function getStatus(pool, authStaff, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  const [summary, tokens, jobs] = await Promise.all([
    bioRepo.getSyncSummary(pool, companyId, branchId),
    bioRepo.listTokens(pool, companyId, branchId),
    bioRepo.listSyncJobs(pool, companyId, branchId, 5),
  ]);
  return { ...summary, tokens, recentJobs: jobs };
}

export async function listUnmatched(pool, authStaff, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  return bioRepo.listUnmatchedPins(pool, companyId, branchId);
}

export async function listStaging(pool, authStaff, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  return bioRepo.listStagingRows(pool, companyId, branchId, {
    devicePin: optionalText(query?.devicePin, 64),
    status: optionalText(query?.status, 20),
    from: query?.from ? parseDate(query.from, 'from') : null,
    to: query?.to ? parseDate(query.to, 'to') : null,
    limit: query?.limit,
  });
}

export async function listPinMap(pool, authStaff, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  return bioRepo.listPinMap(pool, companyId, branchId);
}

/**
 * Maps a device PIN to an employee and immediately replays every staged day for
 * that PIN into hr.attendance_daily.
 *
 * The replay is the whole point of the staging table: attendance recorded
 * before anyone knew who the PIN belonged to still reaches payroll.
 */
export async function mapPin(pool, authStaff, body) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, body?.branchId);
  const devicePin = optionalText(body?.devicePin, 64);
  if (!devicePin) throw badRequest('devicePin is required');
  const employeeId = requirePositiveInt(body?.employeeId, 'employeeId');

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `hr.biometric_sync:${companyId}:${branchId}`,
    ]);

    const { rows: empRows } = await client.query(
      `SELECT employee_id FROM hr.employee_master
        WHERE company_id=$1 AND branch_id=$2 AND employee_id=$3`,
      [companyId, branchId, employeeId],
    );
    if (!empRows[0]) {
      const err = new Error('Employee not found in this branch');
      err.status = 404;
      throw err;
    }

    await bioRepo.upsertPinMap(client, {
      companyId, branchId, devicePin, employeeId,
      deviceName: optionalText(body?.deviceName, 120),
      mappedBy: authStaff?.staff_id != null ? Number(authStaff.staff_id) : null,
    });

    const pending = await bioRepo.listUnmatchedRowsForPin(client, companyId, branchId, devicePin);
    let nextDaily = await bioRepo.nextDailyId(client, companyId, branchId);
    const appliedIds = [];

    for (const row of pending) {
      await bioRepo.upsertAttendanceFromDevice(client, {
        companyId, branchId,
        dailyId: nextDaily++,
        employeeId,
        workDate: toDateOnly(row.workDate),
        firstIn: row.firstIn,
        lastOut: row.lastOut,
        devicePin,
      });
      appliedIds.push(row.stagingId);
    }

    await bioRepo.markStagingApplied(client, companyId, branchId, appliedIds, employeeId);

    return { devicePin, employeeId, replayedDays: appliedIds.length };
  });
}

export async function unmapPin(pool, authStaff, devicePin, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  const pin = optionalText(devicePin, 64);
  if (!pin) throw badRequest('devicePin is required');
  // Attendance already written stays written; only future syncs stop resolving.
  const removed = await withTransaction((client) => bioRepo.deletePinMap(client, companyId, branchId, pin));
  if (!removed) {
    const err = new Error('PIN mapping not found');
    err.status = 404;
    throw err;
  }
  return { devicePin: pin, removed };
}

// Dismisses staged rows for a PIN that will never be an employee — a visitor, a
// test badge, an installer's finger. Reversible via status='unmatched'.
export async function setStagingStatus(pool, authStaff, body) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, body?.branchId);
  const status = optionalText(body?.status, 20);
  if (!['unmatched', 'ignored'].includes(status)) {
    throw badRequest("status must be 'unmatched' or 'ignored'");
  }
  const devicePin = optionalText(body?.devicePin, 64);
  const ids = Array.isArray(body?.stagingIds) ? body.stagingIds.map(Number).filter(Number.isFinite) : [];
  if (!devicePin && !ids.length) throw badRequest('devicePin or stagingIds is required');

  return withTransaction(async (client) => {
    let targetIds = ids;
    if (devicePin && !ids.length) {
      const { rows } = await client.query(
        `SELECT staging_id FROM hr.attendance_biometric_staging
          WHERE company_id=$1 AND branch_id=$2 AND device_pin=$3 AND status <> 'applied'`,
        [companyId, branchId, devicePin],
      );
      targetIds = rows.map((r) => Number(r.staging_id));
    }
    const updated = await bioRepo.setStagingStatus(client, companyId, branchId, targetIds, status);
    return { updated, status };
  });
}
