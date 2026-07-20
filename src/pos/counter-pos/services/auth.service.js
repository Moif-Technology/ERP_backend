import bcrypt from 'bcryptjs';
import { pool } from '../../../config/db.js';
import * as staffRepo from '../repositories/staff.repository.js';
import * as deviceRepo from '../repositories/device.repository.js';
import { buildTokensForStaffRow, buildTokensForPOSDevice } from '../../../core/services/sessionTokens.js';

// Shared token/session builder (kept in sync with ERP auth).
const tokensForStaffRow = (staffRow) => buildTokensForStaffRow(staffRow);

// Cap how many staff the legacy PIN-only fallback will bcrypt-check, so a
// large company can't turn one login attempt into hundreds of bcrypt ops (DoS).
const LEGACY_PIN_SCAN_CAP = 50;

function assertCounterPosAllowed(staffRow) {
  const roleType = String(staffRow.role_software_type || '').toUpperCase();
  if (roleType !== '' && !COUNTER_POS_ALLOWED_TYPES.has(roleType)) {
    const err = new Error('This staff is not authorised for Counter POS');
    err.status = 403;
    throw err;
  }
}

function assertDeviceEnrollmentAdmin(staffRow) {
  const roleId = Number(staffRow?.role_id);
  const roleName = String(staffRow?.role_name || '').trim().toLowerCase();
  if (roleId === 1 || roleName === 'admin' || roleName === 'owner') return;
  const err = new Error('Only an admin can enroll POS devices');
  err.status = 403;
  throw err;
}

/**
 * Enroll a POS device to a company + station.
 * Admin authenticates with email/password. stationId specifies which COUNTER_POS
 * station (from station_master) this device belongs to.
 */
export async function enrollDevice({ adminUsername, adminPassword, deviceToken, stationId, label }) {
  if (!adminUsername || !adminPassword) {
    const err = new Error('Email and password are required');
    err.status = 400;
    throw err;
  }
  if (!deviceToken) {
    const err = new Error('deviceToken is required');
    err.status = 400;
    throw err;
  }

  const { rows } = await staffRepo.findLoginCandidates(pool, String(adminUsername).trim());
  const active = rows.filter((r) => r.record_status === 'ACTIVE');
  if (active.length === 0) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  let adminRow = null;
  for (const row of active) {
    const ok = await bcrypt.compare(String(adminPassword), row.password_hash);
    if (ok) { adminRow = row; break; }
  }
  if (!adminRow) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }
  assertDeviceEnrollmentAdmin(adminRow);

  const companyId = Number(adminRow.company_id);

  // Resolve target station: if stationId provided, look it up; otherwise fall back
  // to admin's own station (for backward compat with older enroll flows).
  let resolvedStationId = stationId != null ? Number(stationId) : null;
  let branchId = Number(adminRow.physical_branch_id ?? adminRow.branch_id);

  if (resolvedStationId != null) {
    const { rows: stnRows } = await pool.query(
      `SELECT branch_id, station_type FROM core.station_master
       WHERE company_id = $1 AND station_id = $2 AND is_deleted = FALSE LIMIT 1`,
      [companyId, resolvedStationId]
    );
    if (!stnRows.length) {
      const err = new Error('Station not found for this company');
      err.status = 400;
      throw err;
    }
    if (stnRows[0].station_type !== 'COUNTER_POS') {
      const err = new Error('Station must be of type COUNTER_POS');
      err.status = 400;
      throw err;
    }
    branchId = Number(stnRows[0].branch_id);
  } else {
    // Legacy: enroll to admin's own station if it's COUNTER_POS
    resolvedStationId = Number(adminRow.station_id ?? adminRow.branch_id);
  }

  await deviceRepo.upsertEnrollment(pool, { deviceToken, companyId, branchId, stationId: resolvedStationId, label });
  const enrollment = await deviceRepo.findByToken(pool, deviceToken);

  return {
    ok: true,
    companyId,
    branchId,
    stationId: resolvedStationId,
    counterNo: Number(enrollment?.counter_no ?? 1),
    label: label ?? null,
  };
}

const COUNTER_POS_ALLOWED_TYPES = new Set(['COUNTER-POS', 'ERP', null, undefined, '']);

/**
 * Verify admin credentials and return available COUNTER_POS stations for that company.
 * Used by the EnrollPage so the admin can pick which station to assign the device to.
 */
export async function listStationsForEnroll({ adminUsername, adminPassword }) {
  if (!adminUsername || !adminPassword) {
    const err = new Error('Email and password are required');
    err.status = 400;
    throw err;
  }

  const { rows } = await staffRepo.findLoginCandidates(pool, String(adminUsername).trim());
  const active = rows.filter((r) => r.record_status === 'ACTIVE');
  if (active.length === 0) {
    const err = new Error('Invalid credentials'); err.status = 401; throw err;
  }

  let adminRow = null;
  for (const row of active) {
    const ok = await bcrypt.compare(String(adminPassword), row.password_hash);
    if (ok) { adminRow = row; break; }
  }
  if (!adminRow) {
    const err = new Error('Invalid credentials'); err.status = 401; throw err;
  }
  assertDeviceEnrollmentAdmin(adminRow);

  const companyId = Number(adminRow.company_id);
  const { rows: stations } = await pool.query(
    `SELECT sm.station_id, sm.station_name, sm.station_code, sm.counter_no, bm.branch_name
     FROM core.station_master sm
     LEFT JOIN core.branch_master bm ON bm.branch_id = sm.branch_id AND bm.company_id = sm.company_id
     WHERE sm.company_id = $1 AND sm.station_type = 'COUNTER_POS' AND sm.is_deleted = FALSE
     ORDER BY sm.station_name`,
    [companyId],
  );

  return {
    companyId,
    stations: stations.map((s) => ({
      stationId:   Number(s.station_id),
      stationName: s.station_name,
      stationCode: s.station_code,
      counterNo:   s.counter_no != null ? Number(s.counter_no) : null,
      branchName:  s.branch_name ?? null,
    })),
  };
}

/**
 * Staff picker for the login screen. Gated by a valid enrolled device token so
 * staff names aren't exposed to arbitrary callers. Returns id + name only.
 */
export async function listStaffForDevice({ deviceToken }) {
  const token = String(deviceToken || '').trim();
  if (!token) {
    const err = new Error('deviceToken is required'); err.status = 400; throw err;
  }
  const enrollment = await deviceRepo.findByToken(pool, token);
  if (!enrollment) {
    const err = new Error('Device not enrolled'); err.status = 401; throw err;
  }
  const rows = await staffRepo.listActiveStaffForPicker(pool, Number(enrollment.company_id));
  return {
    companyId: Number(enrollment.company_id),
    branchId:  Number(enrollment.branch_id),
    stationId: enrollment.station_id != null ? Number(enrollment.station_id) : null,
    counterNo: Number(enrollment.counter_no ?? 1),
    staff: rows.map((r) => ({
      staffPk: Number(r.id),
      staffId: Number(r.staff_id),
      staffName: r.staff_name,
      staffCode: r.staff_code ?? null,
      roleName: r.role_name ?? null,
    })),
  };
}

/**
 * PIN login for Counter-POS.
 * Requires `deviceToken` so we know which station this login is for.
 * Preferred (secure) path: caller passes `staffId` (the picker's staffPk) so we
 * verify exactly ONE staff's PIN — one bcrypt op, no identity ambiguity.
 * Legacy path (no staffId): scan up to LEGACY_PIN_SCAN_CAP staff for backward
 * compatibility. Only roles with software_type COUNTER-POS/ERP may sign in.
 */
export async function loginWithPin({ pin, companyId, staffId, deviceToken }) {
  const pinStr = String(pin || '').trim();
  const cid    = Number(companyId);
  const token  = String(deviceToken || '').trim();

  if (!pinStr) {
    const err = new Error('PIN is required'); err.status = 400; throw err;
  }
  if (!Number.isFinite(cid) || cid < 1) {
    const err = new Error('companyId is required'); err.status = 400; throw err;
  }
  if (!token) {
    const err = new Error('deviceToken is required'); err.status = 400; throw err;
  }
  if (!/^\d{4,6}$/.test(pinStr)) {
    const err = new Error('Invalid PIN'); err.status = 401; throw err;
  }

  // Resolve stationId from enrolled device.
  const enrollment = await deviceRepo.findByToken(pool, token);
  if (!enrollment) {
    const err = new Error('Device not enrolled'); err.status = 401; throw err;
  }
  if (Number(enrollment.company_id) !== cid) {
    const err = new Error('Device not enrolled for this company'); err.status = 401; throw err;
  }
  const stationId = enrollment.station_id != null ? Number(enrollment.station_id) : null;
  if (!Number.isFinite(stationId) || stationId < 1) {
    const err = new Error('Device station is not configured'); err.status = 401; throw err;
  }

  const buildTokens = (row) =>
    buildTokensForPOSDevice(row, stationId);

  // Secure path: a specific staff was selected on the picker.
  const staffPk = Number(staffId);
  if (Number.isFinite(staffPk) && staffPk > 0) {
    const row = await staffRepo.findActiveStaffByIdWithPin(pool, cid, staffPk);
    if (!row) {
      const err = new Error('Invalid credentials'); err.status = 401; throw err;
    }
    const ok = await bcrypt.compare(pinStr, row.staff_pin);
    if (!ok) {
      const err = new Error('Invalid PIN'); err.status = 401; throw err;
    }
    assertCounterPosAllowed(row);
    return buildTokens(row);
  }

  // Legacy fallback: bounded scan (cap protects against bcrypt-storm DoS).
  const staffList = await staffRepo.findAllActiveStaffForCompany(pool, cid);
  if (!staffList.length) {
    const err = new Error('No staff found for this device'); err.status = 401; throw err;
  }
  for (const row of staffList.slice(0, LEGACY_PIN_SCAN_CAP)) {
    const ok = await bcrypt.compare(pinStr, row.staff_pin);
    if (!ok) continue;
    assertCounterPosAllowed(row);
    return buildTokens(row);
  }

  const err = new Error('Invalid PIN'); err.status = 401; throw err;
}
