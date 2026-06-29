import * as authService from '../services/auth.service.js';
import * as passwordResetService from '../services/passwordReset.service.js';
import { pool } from '../../config/db.js';
import * as staffRepo from '../repositories/staff.repository.js';
import { invalidateStaffSession } from '../../middleware/authMiddleware.js';
import { config } from '../../config.js';
import {
  getSessionLimits,
  countActiveSessions,
  registerSession,
  unregisterSession,
  logAuthEvent,
} from '../services/authSession.service.js';

const REFRESH_COOKIE = 'rt';
const REFRESH_COOKIE_OPTS = {
  httpOnly: true,                              // JS cannot read it
  secure: config.nodeEnv === 'production',     // HTTPS only in prod
  sameSite: 'strict',                          // no cross-site sending
  maxAge: 7 * 24 * 60 * 60 * 1000,            // 7 days (ms)
  path: '/api/auth',                           // only sent to auth endpoints
};

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
    res.cookie(REFRESH_COOKIE, refreshToken, REFRESH_COOKIE_OPTS);
    return res.status(status).json({ accessToken, session });
  } catch (err) {
    return handleAuthError(res, err, 'Registration failed');
  }
}

export async function login(req, res) {
  const username = req.body?.username;
  const clientIp = req.ip ?? req.socket?.remoteAddress;
  try {
    const candidates = await staffRepo.findLoginCandidates(pool, String(username || '').trim());
    const candidate = candidates.rows.find((row) => row.record_status === 'ACTIVE');
    if (candidate) {
      req.systemLogContext = {
        companyId: candidate.company_id,
        branchId: candidate.physical_branch_id ?? candidate.branch_id,
        actor: candidate.staff_name || candidate.login_name,
      };
    }
  } catch {
    // Authentication remains available even if audit context lookup fails.
  }
  try {
    const { accessToken, refreshToken, session } = await authService.loginWithCredentials(
      username,
      req.body?.password
    );
    const companyId = session.company?.companyId;
    const staffPk   = session.user?.staffId;

    // Enforce concurrent ERP session limit defined by plan.
    if (companyId) {
      const limits  = await getSessionLimits(pool, companyId);
      const current = await countActiveSessions(pool, companyId, 'erp');
      if (current >= Number(limits?.max_erp_sessions ?? 3)) {
        await logAuthEvent(pool, {
          companyId,
          staffPk,
          eventType: 'session_limit_exceeded',
          ipAddress: clientIp,
          metadata: { session_type: 'erp', current, limit: limits?.max_erp_sessions },
        });
        return res.status(429).json({ message: 'Maximum concurrent ERP sessions reached for your plan' });
      }
    }

    req.systemLogContext = {
      companyId,
      branchId: session.user?.branchId,
      actor: session.user?.staffName || session.user?.loginName,
      message: 'ERP login completed',
    };
    res.cookie(REFRESH_COOKIE, refreshToken, REFRESH_COOKIE_OPTS);

    // Register active session (upsert — one row per staff per type).
    if (companyId && staffPk) {
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // matches JWT_ACCESS_EXPIRES=2h
      await registerSession(pool, staffPk, companyId, 'erp', expiresAt);
      await logAuthEvent(pool, {
        companyId,
        staffPk,
        eventType: 'login_success',
        ipAddress: clientIp,
        metadata: { session_type: 'erp' },
      });
    }

    return res.json({ accessToken, session }); // refreshToken NOT in body
  } catch (err) {
    // Log failed login attempts (best-effort, no staffPk available).
    logAuthEvent(pool, {
      companyId: null,
      staffPk: null,
      eventType: 'login_failed',
      ipAddress: clientIp,
      metadata: { username: String(username || '').trim() },
    });
    return handleAuthError(res, err, 'Login failed');
  }
}

export async function logout(req, res) {
  const staffPk  = req.authStaff?.id ?? req.authStaff?.staff_id;
  const companyId = req.authStaff?.company_id;
  const clientIp  = req.ip ?? req.socket?.remoteAddress;

  await invalidateStaffSession(staffPk);
  await unregisterSession(pool, staffPk, 'erp');
  res.clearCookie(REFRESH_COOKIE, { ...REFRESH_COOKIE_OPTS, maxAge: undefined });

  logAuthEvent(pool, {
    companyId: companyId ?? null,
    staffPk:   staffPk   ?? null,
    eventType: 'logout',
    ipAddress: clientIp,
    metadata:  { session_type: 'erp' },
  });

  res.json({ ok: true });
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
    // Read from httpOnly cookie; fall back to body for old clients during migration.
    const token = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
    const { accessToken } = await authService.refreshAccessToken(token);

    logAuthEvent(pool, {
      companyId: null,
      staffPk:   null,
      eventType: 'token_refresh',
      ipAddress: req.ip ?? req.socket?.remoteAddress,
      metadata:  null,
    });

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

