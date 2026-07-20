import * as authService from '../services/auth.service.js';
import { pool } from '../../../config/db.js';
import {
  getSessionLimits,
  countActiveSessions,
  registerSession,
  logAuthEvent,
} from '../../../core/services/authSession.service.js';

function handleError(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: fallback });
}

/**
 * POST /api/counter-pos/device/enroll
 * Body: { adminUsername, adminPassword, deviceToken, label? }
 * company_id + branch_id derived from admin's staff record — no manual input.
 */
export async function enrollDevice(req, res) {
  try {
    const result = await authService.enrollDevice(req.body);
    return res.json(result);
  } catch (err) {
    return handleError(res, err, 'Device enrollment failed');
  }
}

/**
 * POST /api/counter-pos/device/stations
 * Body: { adminUsername, adminPassword }
 * Verifies admin credentials, returns COUNTER_POS stations for that company.
 */
export async function listStationsForEnroll(req, res) {
  try {
    const result = await authService.listStationsForEnroll(req.body);
    return res.json(result);
  } catch (err) {
    return handleError(res, err, 'Could not load stations');
  }
}

/**
 * POST /api/counter-pos/staff-list
 * Body: { deviceToken }
 * Returns the staff picker (id + name only) for the enrolled device's company.
 */
export async function listStaff(req, res) {
  try {
    const result = await authService.listStaffForDevice(req.body);
    return res.json(result);
  } catch (err) {
    return handleError(res, err, 'Could not load staff');
  }
}

/**
 * POST /api/counter-pos/pin-login
 * Body: { staffId, pin, companyId }   (staffId = staffPk from the picker)
 */
export async function pinLogin(req, res) {
  const clientIp = req.ip ?? req.socket?.remoteAddress;
  try {
    const { accessToken, refreshToken, session } = await authService.loginWithPin(req.body);
    const companyId = session.company?.companyId;
    const staffPk   = session.user?.staffPk;

    // Enforce concurrent POS session limit defined by plan.
    if (companyId) {
      const limits  = await getSessionLimits(pool, companyId);
      const current = await countActiveSessions(pool, companyId, 'pos');
      if (current >= Number(limits?.max_pos_sessions ?? 1)) {
        await logAuthEvent(pool, {
          companyId,
          staffPk,
          eventType: 'session_limit_exceeded',
          ipAddress: clientIp,
          metadata: { session_type: 'pos', current, limit: limits?.max_pos_sessions },
        });
        return res.status(429).json({ message: 'Maximum concurrent POS sessions reached for your plan' });
      }
    }

    req.systemLogContext = {
      companyId,
      branchId: session.user?.branchId,
      actor: session.user?.staffName,
      message: 'Counter POS PIN login completed',
    };

    if (companyId && staffPk) {
      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // matches JWT_POS_ACCESS_EXPIRES=8h
      await registerSession(pool, staffPk, companyId, 'pos', expiresAt);
      await logAuthEvent(pool, {
        companyId,
        staffPk,
        eventType: 'login_success',
        ipAddress: clientIp,
        metadata: { session_type: 'pos' },
      });
    }

    return res.json({ accessToken, refreshToken, session });
  } catch (err) {
    logAuthEvent(pool, {
      companyId: null,
      staffPk:   null,
      eventType: 'login_failed',
      ipAddress: clientIp,
      metadata:  { session_type: 'pos' },
    });
    return handleError(res, err, 'PIN login failed');
  }
}
