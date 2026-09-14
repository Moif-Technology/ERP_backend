/**
 * Public device-enrollment endpoints for Restaurant POS (/api/pos/device/*).
 * POS-scoped token on PIN login — do not mix with /api/pos/login.
 */
import { pool } from '../../../config/db.js';
import * as deviceAuthService from '../services/deviceAuth.service.js';
import {
  registerSession,
  getSessionLimits,
  countActiveSessions,
  logAuthEvent,
} from '../../../core/services/authSession.service.js';

const SESSION_HOURS = 8;

function fail(res, err, fallback) {
  if (err.status) {
    return res.status(err.status).json({ ok: false, code: err.code ?? null, message: err.message });
  }
  console.error('[restaurant device auth]', err);
  return res.status(500).json({ ok: false, code: 'INTERNAL', message: fallback });
}

function sessionPayload(session, accessToken, refreshToken) {
  const u = session.user ?? {};
  const c = session.company ?? {};
  return {
    stationId: u.stationId != null ? String(u.stationId) : '',
    staffName: u.staffName ?? '',
    staffID: u.staffId != null ? String(u.staffId) : '',
    roleId: u.role != null ? String(u.role) : '',
    roleName: u.roleName ?? '',
    companyId: c.companyId != null ? String(c.companyId) : '',
    accessToken,
    refreshToken,
    subscription: session.subscription ?? null,
    features: session.features ?? {},
    limits: session.limits ?? {},
    permissions: session.permissions ?? [],
  };
}

async function openSession(res, { staffPk, companyId, sessionType, clientIp }) {
  if (!companyId || staffPk == null) return null;

  const limits = await getSessionLimits(pool, companyId);
  const current = await countActiveSessions(pool, companyId, sessionType);
  const max = Number(limits?.max_pos_sessions ?? 1);

  if (current >= max) {
    await logAuthEvent(pool, {
      companyId,
      staffPk,
      eventType: 'session_limit_exceeded',
      ipAddress: clientIp,
      metadata: { session_type: sessionType, current, limit: max, pos: 'RESTAURANT-POS' },
    });
    return res.status(429).json({
      ok: false,
      code: 'SESSION_LIMIT',
      message: `Maximum concurrent POS sessions (${max}) reached for your plan.`,
    });
  }

  await registerSession(
    pool,
    staffPk,
    companyId,
    sessionType,
    new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000),
  );
  await logAuthEvent(pool, {
    companyId,
    staffPk,
    eventType: 'login_success',
    ipAddress: clientIp,
    metadata: { session_type: sessionType, pos: 'RESTAURANT-POS' },
  });
  return null;
}

function logFailure(clientIp) {
  logAuthEvent(pool, {
    companyId: null,
    staffPk: null,
    eventType: 'login_failed',
    ipAddress: clientIp,
    metadata: { session_type: 'pos', pos: 'RESTAURANT-POS' },
  }).catch(() => {});
}

export async function listStationsForEnroll(req, res) {
  try {
    return res.json(await deviceAuthService.listStationsForEnroll(req.body));
  } catch (err) {
    return fail(res, err, 'Could not load stations');
  }
}

export async function enrollDevice(req, res) {
  try {
    return res.json(await deviceAuthService.enrollDevice(req.body));
  } catch (err) {
    return fail(res, err, 'Device enrollment failed');
  }
}

export async function staffList(req, res) {
  try {
    return res.json(await deviceAuthService.listStaffForDevice(req.body));
  } catch (err) {
    return fail(res, err, 'Could not load staff list');
  }
}

export async function pinLogin(req, res) {
  const clientIp = req.ip ?? req.socket?.remoteAddress;
  try {
    const { accessToken, refreshToken, session, staffPk } =
      await deviceAuthService.loginWithPin(req.body);

    const blocked = await openSession(res, {
      staffPk,
      companyId: session.company?.companyId,
      sessionType: 'pos',
      clientIp,
    });
    if (blocked) return blocked;

    req.systemLogContext = {
      companyId: session.company?.companyId,
      branchId: session.user?.branchId,
      actor: session.user?.staffName,
      message: 'Restaurant POS PIN login completed',
    };
    return res.json(sessionPayload(session, accessToken, refreshToken));
  } catch (err) {
    logFailure(clientIp);
    return fail(res, err, 'PIN login failed');
  }
}
