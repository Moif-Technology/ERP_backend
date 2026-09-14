/**
 * Supervisor approval — verify username/password against staff_master + role_master.
 * Used by POS for protected actions (delete/qty-change on already-saved job lines, etc.).
 */
import bcrypt from 'bcryptjs';
import { pool } from '../../../config/db.js';
import * as staffRepo from '../../../core/repositories/staff.repository.js';

function bad(message, status = 400, code = null) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

/**
 * Admin / Supervisor / Manager / Owner (by role_id or role_name).
 * role_id 1 is the seeded Admin role.
 */
export function isSupervisorRole(row) {
  const roleId = Number(row?.role_id);
  if (roleId === 1) return true;
  const name = String(row?.role_name ?? '').trim().toLowerCase();
  if (!name) return false;
  return (
    name.includes('supervisor') ||
    name.includes('admin') ||
    name.includes('manager') ||
    name.includes('owner') ||
    name === 'superuser'
  );
}

const PIN_SCAN_CAP = 50;

function supervisorOkPayload(row, username) {
  return {
    ok: true,
    staffId: row.staff_id != null ? String(row.staff_id) : null,
    staffPk: row.id != null ? Number(row.id) : null,
    staffName: row.staff_name ?? username,
    roleId: row.role_id != null ? Number(row.role_id) : null,
    roleName: row.role_name ?? '',
    message: 'Supervisor approved',
  };
}

/**
 * Admin PIN path — any supervisor-class staff in the company whose PIN matches.
 * Bounded scan so one request cannot become a bcrypt storm.
 */
export async function verifySupervisorPin(authStaff, pinRaw) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    throw bad('Company context required', 400, 'NO_COMPANY');
  }

  const pinStr = String(pinRaw || '').trim();
  if (!/^\d{4,6}$/.test(pinStr)) {
    throw bad('Invalid PIN', 401, 'BAD_PIN');
  }

  const rows = await staffRepo.findAllActiveStaffWithPinForCompany(pool, companyId);
  let sawSupervisor = false;
  for (const row of (rows || []).slice(0, PIN_SCAN_CAP)) {
    if (!row.staff_pin) continue;
    const match = await bcrypt.compare(pinStr, row.staff_pin);
    if (!match) continue;
    if (!isSupervisorRole(row)) continue;
    sawSupervisor = true;
    return supervisorOkPayload(row, row.login_name);
  }

  if (!sawSupervisor && (rows || []).length === 0) {
    throw bad('No admin PIN is set. Set a PIN on an Admin user first.', 403, 'NO_ADMIN_PIN');
  }
  throw bad('Invalid admin PIN', 401, 'BAD_PIN');
}

/**
 * Body: { pin } OR { username / login, password }
 * Returns { ok, staffId, staffName, roleName } when the credentials belong to
 * a supervisor-class role in the caller's company.
 */
export async function verifySupervisor(authStaff, body = {}) {
  const pin = String(body.pin ?? body.adminPin ?? '').trim();
  if (pin) return verifySupervisorPin(authStaff, pin);

  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    throw bad('Company context required', 400, 'NO_COMPANY');
  }

  const username = String(body.username ?? body.login ?? body.loginName ?? '').trim();
  const password = String(body.password ?? '');
  if (!username || !password) {
    throw bad('Admin PIN is required', 400, 'MISSING_CREDENTIALS');
  }

  const { rows } = await staffRepo.findLoginCandidates(pool, username);
  const candidates = (rows || []).filter(
    (r) =>
      Number(r.company_id) === companyId &&
      String(r.record_status || '').toUpperCase() === 'ACTIVE'
  );

  if (!candidates.length) {
    throw bad('Invalid username or password', 401, 'BAD_CREDENTIALS');
  }

  for (const row of candidates) {
    if (!row.password_hash) continue;
    const match = await bcrypt.compare(password, row.password_hash);
    if (!match) continue;

    if (!isSupervisorRole(row)) {
      throw bad(
        `User "${row.staff_name || username}" is not a supervisor. ` +
          `Ask an Admin / Supervisor to approve this action.`,
        403,
        'NOT_SUPERVISOR'
      );
    }

    return supervisorOkPayload(row, username);
  }

  throw bad('Invalid username or password', 401, 'BAD_CREDENTIALS');
}
