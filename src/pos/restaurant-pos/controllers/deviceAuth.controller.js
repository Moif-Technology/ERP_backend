/**
 * Restaurant / Quick-service POS device authentication (the till flow).
 *
 * TWO login paths exist for this product, with different token scopes — the
 * distinction matters and getting it wrong produces "Session expired" on the
 * request right after a successful login:
 *
 *  A) Device + PIN — THIS FILE.
 *       /device/stations -> /device/enroll -> /staff-list -> /pin-login
 *     Uses buildTokensForPOSDevice, which signs a POS-SCOPED token
 *     (scope:'pos' + station in `sid`). authMiddleware derives sessionType 'pos'
 *     from that scope, so the session MUST be registered as 'pos'.
 *
 *  B) Username + password — pos.controller.js `login`.
 *     Uses loginWithCredentialsForPOS -> buildTokensForStaffRow, an ERP-scoped
 *     token. authMiddleware derives 'erp' from it.
 *
 * `staffPk` passed to registerSession MUST be core.staff_master.id (the JWT
 * `sub`), never the business staff_id — a session stored under the business id
 * can never be looked up again.
 */
import { pool } from '../../../config/db.js';
import * as deviceAuthService from '../services/deviceAuth.service.js';
import {
  registerSession,
  getSessionLimits,
  countActiveSessions,
  logAuthEvent,
} from '../../../core/services/authSession.service.js';

const POS_NAME = 'RESTAURANT-POS';
const SESSION_HOURS = 8;

function fail(res, err, fallback) {
  if (err.status) {
    return res.status(err.status).json({ ok: false, code: err.code ?? null, message: err.message });
  }
  console.error('[restaurant device auth]', err);
  return res.status(500).json({ ok: false, code: 'INTERNAL', message: fallback });
}

/** Shape the Deyno Quick / Flutter clients expect — identical to salon's, maps 1:1. */
function sessionPayload(session, accessToken, refreshToken, extra = {}) {
  const u = session.user ?? {};
  const c = session.company ?? {};
  return {
    stationId: u.stationId != null ? String(u.stationId) : '',
    staffName: u.staffName ?? '',
    staffID:   u.staffId  != null ? String(u.staffId) : '',
    roleId:    u.role     != null ? String(u.role) : '',
    roleName:  u.roleName ?? '',
    companyId: c.companyId != null ? String(c.companyId) : '',
    companyName: c.companyName ?? '',
    accessToken,
    refreshToken,
    subscription: session.subscription ?? null,
    features:     session.features ?? {},
    limits:       session.limits ?? {},
    permissions:  session.permissions ?? [],
    ...extra,
  };
}

/**
 * Register a POS session, enforcing the plan's concurrent cap.
 * Returns a response object if blocked, otherwise null.
 */
async function openSession(res, { staffPk, companyId, clientIp }) {
  if (!companyId || staffPk == null) return null;

  const limits  = await getSessionLimits(pool, companyId);
  const current = await countActiveSessions(pool, companyId, 'pos');
  const max     = Number(limits?.max_pos_sessions ?? 1);

  if (current >= max) {
    await logAuthEvent(pool, {
      companyId, staffPk,
      eventType: 'session_limit_exceeded',
      ipAddress: clientIp,
      metadata: { session_type: 'pos', current, limit: max, pos: POS_NAME },
    });
    return res.status(429).json({
      ok: false,
      code: 'SESSION_LIMIT',
      message: `Maximum concurrent POS sessions (${max}) reached for your plan.`,
    });
  }

  await registerSession(
    pool, staffPk, companyId, 'pos',
    new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000)
  );
  await logAuthEvent(pool, {
    companyId, staffPk,
    eventType: 'login_success',
    ipAddress: clientIp,
    metadata: { session_type: 'pos', pos: POS_NAME },
  });
  return null;
}

function logFailure(clientIp) {
  logAuthEvent(pool, {
    companyId: null, staffPk: null,
    eventType: 'login_failed',
    ipAddress: clientIp,
    metadata: { session_type: 'pos', pos: POS_NAME },
  }).catch(() => {});
}

/** POST /api/pos/device/stations — admin credentials in, RESTAURANT_POS stations out. */
export async function listStationsForEnroll(req, res) {
  try {
    return res.json(await deviceAuthService.listStationsForEnroll(req.body));
  } catch (err) {
    return fail(res, err, 'Could not load stations');
  }
}

/** POST /api/pos/device/enroll — pair this device to a company + RESTAURANT_POS station. */
export async function enrollDevice(req, res) {
  try {
    return res.json(await deviceAuthService.enrollDevice(req.body));
  } catch (err) {
    return fail(res, err, 'Device enrollment failed');
  }
}

/** POST /api/pos/device/staff-list — staff picker, gated by the enrolled deviceToken. */
export async function staffListForDevice(req, res) {
  try {
    return res.json(await deviceAuthService.listStaffForDevice(req.body));
  } catch (err) {
    return fail(res, err, 'Could not load staff list');
  }
}

/** POST /api/pos/device/pin-login — { deviceToken, companyId, staffId, pin }. POS-scoped token. */
export async function pinLogin(req, res) {
  const clientIp = req.ip ?? req.socket?.remoteAddress;
  try {
    const { accessToken, refreshToken, session, staffPk, counterNo } =
      await deviceAuthService.loginWithPin(req.body);

    const blocked = await openSession(res, {
      staffPk,
      companyId: session.company?.companyId,
      clientIp,
    });
    if (blocked) return blocked;

    req.systemLogContext = {
      companyId: session.company?.companyId,
      branchId:  session.user?.branchId,
      actor:     session.user?.staffName,
      message:   'Restaurant POS device PIN login completed',
    };
    return res.json(sessionPayload(session, accessToken, refreshToken, { counterNo }));
  } catch (err) {
    logFailure(clientIp);
    return fail(res, err, 'PIN login failed');
  }
}
