import { pool } from '../../config/db.js';
import * as bioService from '../services/biometric.service.js';

function handle(err, res, fallbackMessage) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.code === '42P01') {
    return res.status(503).json({
      message: 'Biometric sync tables are not installed. Apply migration 106_hr_biometric_sync.sql.',
    });
  }
  if (err.code === '23505') {
    return res.status(409).json({ message: 'Duplicate biometric record for this branch/company.' });
  }
  console.error(err);
  return res.status(500).json({ message: fallbackMessage });
}

// ── Device-facing (bearer device token, no staff session) ─────────────────────
// Every handler here re-authenticates from the header. A device token carries
// its own tenant, so nothing in the request body is ever trusted to say which
// company the data belongs to.
async function deviceTenant(req, res) {
  const token = await bioService.authenticateDevice(pool, req.headers.authorization, req.ip);
  if (!token) {
    res.status(401).json({ message: 'Invalid or inactive device token' });
    return null;
  }
  return token;
}

export async function devicePing(req, res) {
  try {
    const tenant = await deviceTenant(req, res);
    if (!tenant) return undefined;
    return res.json({
      ok: true,
      companyId: tenant.companyId,
      branchId: tenant.branchId,
      label: tenant.label,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    return handle(err, res, 'Device ping failed');
  }
}

export async function deviceSync(req, res) {
  try {
    const tenant = await deviceTenant(req, res);
    if (!tenant) return undefined;
    const result = await bioService.applySync(pool, tenant, req.body);
    return res.json(result);
  } catch (err) {
    return handle(err, res, 'Could not apply biometric sync');
  }
}

export async function deviceJobs(req, res) {
  try {
    const tenant = await deviceTenant(req, res);
    if (!tenant) return undefined;
    const jobs = await bioService.claimJobsForDevice(pool, tenant, req.query?.limit);
    return res.json({ jobs });
  } catch (err) {
    return handle(err, res, 'Could not read sync jobs');
  }
}

export async function deviceJobFailed(req, res) {
  try {
    const tenant = await deviceTenant(req, res);
    if (!tenant) return undefined;
    await bioService.failSyncJob(pool, tenant, req.params.jobId, req.body?.message);
    return res.json({ ok: true });
  } catch (err) {
    return handle(err, res, 'Could not mark sync job failed');
  }
}

// ── HR-facing (normal staff session) ─────────────────────────────────────────
export async function getStatus(req, res) {
  try {
    return res.json(await bioService.getStatus(pool, req.authStaff, req.query));
  } catch (err) {
    return handle(err, res, 'Could not load biometric sync status');
  }
}

export async function listUnmatched(req, res) {
  try {
    return res.json({ unmatched: await bioService.listUnmatched(pool, req.authStaff, req.query) });
  } catch (err) {
    return handle(err, res, 'Could not load unmatched device PINs');
  }
}

export async function listStaging(req, res) {
  try {
    return res.json({ rows: await bioService.listStaging(pool, req.authStaff, req.query) });
  } catch (err) {
    return handle(err, res, 'Could not load staged biometric rows');
  }
}

export async function listPinMap(req, res) {
  try {
    return res.json({ mappings: await bioService.listPinMap(pool, req.authStaff, req.query) });
  } catch (err) {
    return handle(err, res, 'Could not load PIN mappings');
  }
}

export async function mapPin(req, res) {
  try {
    return res.status(201).json(await bioService.mapPin(pool, req.authStaff, req.body));
  } catch (err) {
    return handle(err, res, 'Could not map device PIN');
  }
}

export async function unmapPin(req, res) {
  try {
    return res.json(await bioService.unmapPin(pool, req.authStaff, req.params.devicePin, req.query));
  } catch (err) {
    return handle(err, res, 'Could not remove PIN mapping');
  }
}

export async function setStagingStatus(req, res) {
  try {
    return res.json(await bioService.setStagingStatus(pool, req.authStaff, req.body));
  } catch (err) {
    return handle(err, res, 'Could not update staged rows');
  }
}

export async function enqueueSyncJob(req, res) {
  try {
    return res.status(201).json(await bioService.enqueueSyncJob(pool, req.authStaff, req.body));
  } catch (err) {
    return handle(err, res, 'Could not queue attendance sync');
  }
}

export async function listSyncJobs(req, res) {
  try {
    return res.json({ jobs: await bioService.listSyncJobs(pool, req.authStaff, req.query) });
  } catch (err) {
    return handle(err, res, 'Could not load sync jobs');
  }
}
