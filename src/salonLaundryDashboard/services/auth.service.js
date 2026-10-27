/**
 * Dashboard Auth Service
 * Authenticates only tenant admin staff for salon dashboard access.
 */

import bcrypt from 'bcryptjs';
import * as authRepo from '../repositories/auth.repository.js';
import { buildTokensForStaffRow } from '../../core/services/sessionTokens.js';

export async function loginDashboardAdmin(db, username, password) {
  const login = String(username || '').trim();
  if (!login || !password) {
    const err = new Error('username and password are required');
    err.status = 400;
    throw err;
  }

  const { rows } = await authRepo.findLoginCandidates(db, login);
  const active = rows.filter((row) => row.record_status === 'ACTIVE');
  if (active.length !== 1) {
    const err = new Error('Invalid username or password');
    err.status = 401;
    throw err;
  }

  const staff = active[0];
  const passwordOk = await bcrypt.compare(String(password), staff.password_hash);
  if (!passwordOk) {
    const err = new Error('Invalid username or password');
    err.status = 401;
    throw err;
  }

  if (staff.email_verified === false) {
    const err = new Error('Please verify your email before signing in.');
    err.status = 403;
    err.code = 'EMAIL_NOT_VERIFIED';
    throw err;
  }

  const isAdminRole = Number(staff.role_id) === 1;
  const isAdminName = String(staff.role_name || '').toLowerCase().includes('admin');
  const isAdminDesignation = String(staff.designation || '').toLowerCase().includes('admin');

  if (!isAdminRole && !isAdminName && !isAdminDesignation) {
    const err = new Error('Dashboard login is allowed only for admin users');
    err.status = 403;
    throw err;
  }

  return buildTokensForStaffRow(staff);
}
