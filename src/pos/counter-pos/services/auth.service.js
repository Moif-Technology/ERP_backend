import bcrypt from 'bcryptjs';
import { pool } from '../../../config/db.js';
import * as staffRepo from '../repositories/staff.repository.js';
import * as deviceRepo from '../repositories/device.repository.js';
import { buildTokensForStaffRow } from '../../../core/services/sessionTokens.js';

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

/**
 * Enroll a POS device to a company+branch.
 * Admin authenticates with email/password — company_id and branch_id are
 * derived from their staff record, no manual ID entry needed.
 */
export async function enrollDevice({ adminUsername, adminPassword, deviceToken, label }) {
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

  // Pick first matching active staff; verify password
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

  const companyId = Number(adminRow.company_id);
  const branchId  = Number(adminRow.branch_id);

  await deviceRepo.upsertEnrollment(pool, { deviceToken, companyId, branchId, label });
  const enrollment = await deviceRepo.findByToken(pool, deviceToken);

  return {
    ok: true,
    companyId,
    branchId,
    counterNo: Number(enrollment?.counter_no ?? 1),
    label: label ?? null,
  };
}

const COUNTER_POS_ALLOWED_TYPES = new Set(['COUNTER-POS', 'ERP', null, undefined, '']);

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
    branchId: Number(enrollment.branch_id),
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
 * Preferred (secure) path: caller passes `staffId` (the picker's staffPk) so we
 * verify exactly ONE staff's PIN — one bcrypt op, no identity ambiguity.
 * Legacy path (no staffId): scan up to LEGACY_PIN_SCAN_CAP staff for backward
 * compatibility. Only roles with software_type COUNTER-POS/ERP may sign in.
 */
export async function loginWithPin({ pin, companyId, staffId }) {
  const pinStr = String(pin || '').trim();
  const cid    = Number(companyId);

  if (!pinStr) {
    const err = new Error('PIN is required'); err.status = 400; throw err;
  }
  if (!Number.isFinite(cid) || cid < 1) {
    const err = new Error('companyId is required'); err.status = 400; throw err;
  }
  if (!/^\d{4,6}$/.test(pinStr)) {
    const err = new Error('Invalid PIN'); err.status = 401; throw err;
  }

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
    return tokensForStaffRow(row);
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
    return tokensForStaffRow(row);
  }

  const err = new Error('Invalid PIN'); err.status = 401; throw err;
}
