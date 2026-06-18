import * as authService from '../services/auth.service.js';
import * as passwordResetService from '../services/passwordReset.service.js';
import { pool } from '../../config/db.js';

const DB_NOT_READY =
  'Database is not ready. Create core tables and run database/migrations/001_registration_extensions.sql';

function handleAuthError(res, err, fallbackMessage) {
  if (err.status) {
    return res.status(err.status).json({ message: err.message });
  }
  if (err.code === 'EMAIL_IN_USE') {
    return res.status(409).json({ message: err.message });
  }
  if (err.code === '23505') {
    return res.status(409).json({ message: 'Company or user code already exists' });
  }
  if (err.code === '42P01' || err.message?.includes('does not exist')) {
    return res.status(503).json({ message: DB_NOT_READY });
  }
  if (err.code === '42703') {
    return res.status(503).json({
      message:
        'Database column missing. Run pending migrations (e.g. database/migrations/003_company_welcome_screen.sql).',
    });
  }
  console.error(err);
  return res.status(500).json({ message: fallbackMessage });
}

export async function register(req, res) {
  try {
    const result = await authService.registerAccount(req.body);
    const { status, accessToken, refreshToken, session } = result;
    return res.status(status).json({ accessToken, refreshToken, session });
  } catch (err) {
    return handleAuthError(res, err, 'Registration failed');
  }
}

export async function login(req, res) {
  try {
    const { accessToken, refreshToken, session } = await authService.loginWithCredentials(
      req.body?.username,
      req.body?.password
    );
    return res.json({ accessToken, refreshToken, session });
  } catch (err) {
    return handleAuthError(res, err, 'Login failed');
  }
}

export function logout(_req, res) {
  res.json(authService.logout());
}

export async function me(req, res) {
  try {
    const session = await authService.currentSessionFromStaffRow(req.authStaff);
    res.json({ user: session.user, session });
  } catch (err) {
    return handleAuthError(res, err, 'Could not load current session');
  }
}

export async function accessVersion(req, res) {
  try {
    const version = await authService.currentAccessVersionFromStaffRow(req.authStaff);
    return res.json({ version });
  } catch (err) {
    return handleAuthError(res, err, 'Could not load access version');
  }
}

export async function accessRefresh(req, res) {
  try {
    const access = await authService.currentAccessOnlyFromStaffRow(req.authStaff);
    return res.json({ access });
  } catch (err) {
    return handleAuthError(res, err, 'Could not refresh access');
  }
}

export async function refresh(req, res) {
  try {
    const { accessToken } = await authService.refreshAccessToken(req.body?.refreshToken);
    return res.json({ accessToken });
  } catch (err) {
    return handleAuthError(res, err, 'Refresh failed');
  }
}

export async function completeWelcome(req, res) {
  try {
    const result = await authService.completeWelcomeForCompany(pool, req.authStaff.company_id);
    return res.json(result);
  } catch (err) {
    return handleAuthError(res, err, 'Could not complete welcome');
  }
}

export async function forgotPassword(req, res) {
  try {
    const result = await passwordResetService.requestForgotPasswordOtp(req.body);
    return res.json(result);
  } catch (err) {
    return handleAuthError(res, err, 'Could not request password reset');
  }
}

export async function resetPassword(req, res) {
  try {
    const result = await passwordResetService.resetPasswordWithOtp(req.body);
    return res.json(result);
  } catch (err) {
    return handleAuthError(res, err, 'Could not reset password');
  }
}

