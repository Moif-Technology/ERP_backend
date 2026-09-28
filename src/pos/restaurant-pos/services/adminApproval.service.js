/**
 * Restaurant POS admin approval — same gate as Mainfrm.vb / AdminLoginFrm.vb:
 *   If gvUserDesignation <> "CHIEF CASHIER" And gvUserDesignation <> "ADMIN"
 *     → AdminLoginFrm (login + password of ADMIN or CHIEF CASHIER)
 *
 * Current till user skips the dialog when their designation (or role) is
 * CHIEF CASHIER / ADMIN. Approving credentials must belong to those designations.
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

function upper(v) {
  return String(v ?? '').trim().toUpperCase();
}

/** VB: Designation IN ('ADMIN','CHIEF CASHIER'). Also accept matching role_name / role_id 1. */
export function isChiefCashierOrAdmin(row) {
  if (!row) return false;
  const designation = upper(row.designation);
  if (designation === 'ADMIN' || designation === 'CHIEF CASHIER') return true;
  const roleName = upper(row.role_name ?? row.roleName);
  if (roleName === 'ADMIN' || roleName === 'CHIEF CASHIER') return true;
  return Number(row.role_id ?? row.roleId) === 1;
}

function approvalPayload(row, username) {
  return {
    ok: true,
    IsAdmin: 1,
    staffId: row.staff_id != null ? String(row.staff_id) : null,
    staffPk: row.id != null ? Number(row.id) : null,
    staffName: row.staff_name ?? username,
    designation: row.designation ?? '',
    roleId: row.role_id != null ? Number(row.role_id) : null,
    roleName: row.role_name ?? '',
    message: 'Admin approved',
  };
}

/**
 * Body: { username / login, password } — AdminLoginFrm.btnLogin_Click.
 * Returns { ok, staffId, staffName, designation } when credentials belong to
 * ADMIN or CHIEF CASHIER in the caller's company.
 */
export async function verifyAdminCredentials(authStaff, body = {}) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    throw bad('Company context required', 400, 'NO_COMPANY');
  }

  const username = String(body.username ?? body.login ?? body.adminUsername ?? body.loginName ?? '').trim();
  const password = String(body.password ?? body.adminPassword ?? '');
  if (!username || !password) {
    throw bad('Enter Login Name...', 400, 'MISSING_CREDENTIALS');
  }

  const { rows } = await staffRepo.findLoginCandidates(pool, username);
  const candidates = (rows || []).filter(
    (r) =>
      Number(r.company_id) === companyId &&
      String(r.record_status || '').toUpperCase() === 'ACTIVE',
  );

  if (!candidates.length) {
    throw bad('Password Failed...', 403, 'BAD_CREDENTIALS');
  }

  for (const row of candidates) {
    if (!row.password_hash) continue;
    const match = await bcrypt.compare(password, row.password_hash);
    if (!match) continue;

    if (!isChiefCashierOrAdmin(row)) {
      throw bad('Password Failed...', 403, 'NOT_ADMIN');
    }

    return approvalPayload(row, username);
  }

  throw bad('Password Failed...', 403, 'BAD_CREDENTIALS');
}

/**
 * Skip when the till user is CHIEF CASHIER / ADMIN.
 * Otherwise require AdminLoginFrm credentials on the same request body.
 */
export async function requireChiefCashierOrAdmin(authStaff, body = {}) {
  if (isChiefCashierOrAdmin(authStaff)) {
    return {
      skipped: true,
      supervisorId: parseLong(authStaff.staff_id) ?? parseLong(authStaff.id),
      supervisorName: authStaff.staff_name ?? '',
    };
  }

  const username = String(body.username ?? body.login ?? body.adminUsername ?? '').trim();
  const password = String(body.password ?? body.adminPassword ?? '');
  if (!username || !password) {
    throw bad('Admin approval required', 403, 'ADMIN_REQUIRED');
  }

  const approved = await verifyAdminCredentials(authStaff, body);
  return {
    skipped: false,
    supervisorId: parseLong(approved.staffId) ?? approved.staffPk,
    supervisorName: approved.staffName,
  };
}

function parseLong(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.trunc(n);
}
