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

/**
 * Body: { username / login, password }
 * Returns { ok, staffId, staffName, roleName } when the credentials belong to
 * a supervisor-class role in the caller's company.
 */
export async function verifySupervisor(authStaff, body = {}) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    throw bad('Company context required', 400, 'NO_COMPANY');
  }

  const username = String(body.username ?? body.login ?? body.loginName ?? '').trim();
  const password = String(body.password ?? '');
  if (!username || !password) {
    throw bad('Username and password are required', 400, 'MISSING_CREDENTIALS');
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

  throw bad('Invalid username or password', 401, 'BAD_CREDENTIALS');
}
