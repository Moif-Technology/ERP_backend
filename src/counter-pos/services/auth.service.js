import bcrypt from 'bcryptjs';
import { pool } from '../../config/db.js';
import * as staffRepo from '../repositories/staff.repository.js';
import * as deviceRepo from '../repositories/device.repository.js';
import { buildSessionPayload } from '../../services/session.js';
import { signAccessToken, signRefreshToken } from '../../services/token.service.js';
import { resolveEntitlementsForStaff, getEntitlementVersionForStaff } from '../../services/entitlement.service.js';

async function tokensForStaffRow(staffRow) {
  const [access, accessVersion] = await Promise.all([
    resolveEntitlementsForStaff(staffRow),
    getEntitlementVersionForStaff(staffRow),
  ]);
  return {
    accessToken: signAccessToken({ typ: 'access', sub: String(staffRow.id), cid: staffRow.company_id }),
    refreshToken: signRefreshToken({ typ: 'refresh', sub: String(staffRow.id) }),
    session: { ...buildSessionPayload(staffRow, access), accessVersion },
  };
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

  return { ok: true, companyId, branchId, label: label ?? null };
}

/**
 * PIN-only login for Counter-POS.
 * Device is enrolled to a company — staff identified by PIN alone.
 * Tries each active staff member's hash until one matches (O(n) bcrypt).
 */
export async function loginWithPin({ pin, companyId }) {
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

  const staffList = await staffRepo.findAllActiveStaffForCompany(pool, cid);
  if (!staffList.length) {
    const err = new Error('No staff found for this device'); err.status = 401; throw err;
  }

  for (const row of staffList) {
    const ok = await bcrypt.compare(pinStr, row.staff_pin);
    if (ok) return tokensForStaffRow(row);
  }

  const err = new Error('Invalid PIN'); err.status = 401; throw err;
}
