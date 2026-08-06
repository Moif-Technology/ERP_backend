/**
 * Salon POS authentication.
 *
 * TWO login paths, with different token scopes — this matters:
 *
 *  A) Device + PIN (the till flow, mirrors Counter-POS)
 *       /device/stations -> /device/enroll -> /staff-list -> /pin-login
 *     Uses buildTokensForPOSDevice, which signs a POS-SCOPED token
 *     (scope:'pos' + station in `sid`). authMiddleware derives sessionType 'pos'
 *     from that scope, so the session is registered as 'pos'.
 *
 *  B) Username + password (admin/back-office convenience)
 *     Uses loginWithCredentialsForPOS -> buildTokensForStaffRow, which signs an
 *     ERP-scoped token (no scope claim). authMiddleware then derives 'erp', so
 *     that session MUST be registered as 'erp' or every later request 401s.
 *
 * Getting these two crossed is exactly the "Session expired" bug that restaurant
 * POS has: it registers 'pos' while issuing an ERP-scoped token.
 *
 * Why not reuse restaurant's controllers at all:
 *   - they hardcode posType 'RESTAURANT-POS', which rejects SALON-POS roles
 *   - their username/password path never calls registerSession
 *   - they register the BUSINESS staff id where the surrogate PK is required
 */
import { pool } from '../../../config/db.js';
import * as coreAuthService from '../../../core/services/auth.service.js';
import * as salonAuthService from '../services/auth.service.js';
import * as staffRepo from '../../../core/repositories/staff.repository.js';
import {
  registerSession,
  getSessionLimits,
  countActiveSessions,
  logAuthEvent,
} from '../../../core/services/authSession.service.js';

const SALON_POS_TYPE = 'SALON-POS';
const SESSION_HOURS = 8;

function fail(res, err, fallback) {
  if (err.status) {
    return res.status(err.status).json({ ok: false, code: err.code ?? null, message: err.message });
  }
  console.error('[salon auth]', err);
  return res.status(500).json({ ok: false, code: 'INTERNAL', message: fallback });
}

/** Shape the Flutter client expects — identical to restaurant's so it maps 1:1. */
function sessionPayload(session, accessToken, refreshToken) {
  const u = session.user ?? {};
  const c = session.company ?? {};
  return {
    stationId: u.stationId != null ? String(u.stationId) : '',
    staffName: u.staffName ?? '',
    staffID:   u.staffId  != null ? String(u.staffId) : '',
    roleId:    u.role != null ? String(u.role) : '',
    roleName:  u.roleName ?? '',
    companyId: c.companyId != null ? String(c.companyId) : '',
    accessToken,
    refreshToken,
    subscription: session.subscription ?? null,
    features:     session.features ?? {},
    limits:       session.limits ?? {},
    permissions:  session.permissions ?? [],
  };
}

/**
 * Register a session of the given type, enforcing the plan's concurrent cap.
 * `staffPk` MUST be core.staff_master.id (the JWT `sub`), never the business
 * staff_id — a session stored under the business id can never be looked up.
 * Returns a response if blocked, otherwise null.
 */
async function openSession(res, { staffPk, companyId, sessionType, clientIp }) {
  if (!companyId || staffPk == null) return null;

  const limits  = await getSessionLimits(pool, companyId);
  const current = await countActiveSessions(pool, companyId, sessionType);
  const max     = Number(limits?.max_pos_sessions ?? 1);

  if (current >= max) {
    await logAuthEvent(pool, {
      companyId, staffPk,
      eventType: 'session_limit_exceeded',
      ipAddress: clientIp,
      metadata: { session_type: sessionType, current, limit: max, pos: SALON_POS_TYPE },
    });
    return res.status(429).json({
      ok: false,
      code: 'SESSION_LIMIT',
      message: `Maximum concurrent POS sessions (${max}) reached for your plan.`,
    });
  }

  await registerSession(
    pool, staffPk, companyId, sessionType,
    new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000)
  );
  await logAuthEvent(pool, {
    companyId, staffPk,
    eventType: 'login_success',
    ipAddress: clientIp,
    metadata: { session_type: sessionType, pos: SALON_POS_TYPE },
  });
  return null;
}

function logFailure(clientIp) {
  logAuthEvent(pool, {
    companyId: null, staffPk: null,
    eventType: 'login_failed',
    ipAddress: clientIp,
    metadata: { session_type: 'pos', pos: SALON_POS_TYPE },
  }).catch(() => {});
}

// ── A) Device enrollment ───────────────────────────────────────────────────

/** POST /device/stations — admin credentials in, SALON_POS stations out. */
export async function listStationsForEnroll(req, res) {
  try {
    return res.json(await salonAuthService.listStationsForEnroll(req.body));
  } catch (err) {
    return fail(res, err, 'Could not load stations');
  }
}

/** POST /device/enroll — pair this device to a company + SALON_POS station. */
export async function enrollDevice(req, res) {
  try {
    return res.json(await salonAuthService.enrollDevice(req.body));
  } catch (err) {
    return fail(res, err, 'Device enrollment failed');
  }
}

/** POST /staff-list — staff picker, gated by the enrolled deviceToken. */
export async function staffList(req, res) {
  try {
    return res.json(await salonAuthService.listStaffForDevice(req.body));
  } catch (err) {
    return fail(res, err, 'Could not load staff list');
  }
}

/** POST /pin-login — { deviceToken, companyId, staffId, pin }. POS-scoped token. */
export async function pinLogin(req, res) {
  const clientIp = req.ip ?? req.socket?.remoteAddress;
  try {
    const { accessToken, refreshToken, session, staffPk } =
      await salonAuthService.loginWithPin(req.body);

    const blocked = await openSession(res, {
      staffPk,
      companyId: session.company?.companyId,
      sessionType: 'pos',   // POS-scoped token -> authMiddleware looks for 'pos'
      clientIp,
    });
    if (blocked) return blocked;

    req.systemLogContext = {
      companyId: session.company?.companyId,
      branchId:  session.user?.branchId,
      actor:     session.user?.staffName,
      message:   'Salon POS PIN login completed',
    };
    return res.json(sessionPayload(session, accessToken, refreshToken));
  } catch (err) {
    logFailure(clientIp);
    return fail(res, err, 'PIN login failed');
  }
}

// ── B) Username + password ─────────────────────────────────────────────────

/** POST /login — admin convenience path. ERP-scoped token, 'erp' session. */
export async function login(req, res) {
  const username = req.body?.login ?? req.body?.username;
  const password = req.body?.password;
  const clientIp = req.ip ?? req.socket?.remoteAddress;

  try {
    const { accessToken, refreshToken, session } =
      await coreAuthService.loginWithCredentialsForPOS(username, password, SALON_POS_TYPE);

    const companyId = session.company?.companyId;
    // session.user.staffId is the BUSINESS id; resolve the surrogate PK, which is
    // what the JWT `sub` and active_session.staff_pk use.
    const staffPk = companyId != null
      ? await staffRepo.findStaffPk(pool, companyId, session.user?.staffId)
      : null;

    // Username/password maps staff.branch_id → stationId, which is often the
    // BACKOFFICE row. Prefer the company's SALON_POS till so Save Job / settle
    // receive a real front-desk station id.
    if (companyId != null && session.user) {
      const { rows } = await pool.query(
        `SELECT station_id
           FROM core.station_master
          WHERE company_id = $1
            AND station_type = 'SALON_POS'
            AND is_deleted = FALSE
          ORDER BY station_id
          LIMIT 1`,
        [companyId]
      );
      if (rows[0]?.station_id != null) {
        session.user.stationId = Number(rows[0].station_id);
      }
    }

    const blocked = await openSession(res, {
      staffPk, companyId,
      sessionType: 'erp',   // ERP-scoped token -> authMiddleware looks for 'erp'
      clientIp,
    });
    if (blocked) return blocked;

    req.systemLogContext = {
      companyId,
      branchId: session.user?.branchId,
      actor:    session.user?.staffName,
      message:  'Salon POS login completed',
    };
    return res.json(sessionPayload(session, accessToken, refreshToken));
  } catch (err) {
    logFailure(clientIp);
    return fail(res, err, 'Login failed');
  }
}
