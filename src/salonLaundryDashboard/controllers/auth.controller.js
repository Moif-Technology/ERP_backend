/**
 * Dashboard Auth Controller
 * Public login endpoint for salon dashboard admins.
 */

import { pool } from '../../config/db.js';
import * as dashboardAuthService from '../services/auth.service.js';
import {
  countActiveSessions,
  getSessionLimits,
  logAuthEvent,
  registerSession,
} from '../../core/services/authSession.service.js';

function handleAuthError(res, err, fallbackMessage) {
  if (err.status) {
    return res.status(err.status).json({ message: err.message, code: err.code ?? null });
  }
  console.error('[dashboard auth]', err);
  return res.status(500).json({ message: fallbackMessage });
}

export async function login(req, res) {
  const username = req.body?.username ?? req.body?.email ?? req.body?.login;
  const clientIp = req.ip ?? req.socket?.remoteAddress;

  try {
    const { accessToken, refreshToken, session } =
      await dashboardAuthService.loginDashboardAdmin(pool, username, req.body?.password);
    const companyId = session.company?.companyId;
    const staffPk = session.user?.staffPk;

    if (companyId) {
      const limits = await getSessionLimits(pool, companyId);
      const current = await countActiveSessions(pool, companyId, 'erp');
      if (current >= Number(limits?.max_erp_sessions ?? 3)) {
        await logAuthEvent(pool, {
          companyId,
          staffPk,
          eventType: 'session_limit_exceeded',
          ipAddress: clientIp,
          metadata: { session_type: 'erp', current, limit: limits?.max_erp_sessions, app: 'salon-dashboard' },
        });
        return res.status(429).json({ message: 'Maximum concurrent ERP sessions reached for your plan' });
      }
    }

    if (companyId && staffPk) {
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
      await registerSession(pool, staffPk, companyId, 'erp', expiresAt);
      await logAuthEvent(pool, {
        companyId,
        staffPk,
        eventType: 'login_success',
        ipAddress: clientIp,
        metadata: { session_type: 'erp', app: 'salon-dashboard' },
      });
    }

    req.systemLogContext = {
      companyId,
      branchId: session.user?.branchId,
      actor: session.user?.staffName || session.user?.loginName,
      message: 'Salon dashboard admin login completed',
    };

    return res.json({
      token: accessToken,
      accessToken,
      refreshToken,
      user: {
        id: String(session.user?.staffPk ?? ''),
        staffId: session.user?.staffId,
        email: session.user?.email,
        name: session.user?.staffName,
        role: session.user?.roleName || 'Admin',
        roleId: session.user?.role,
        permissions: session.permissions || [],
      },
      session,
    });
  } catch (err) {
    logAuthEvent(pool, {
      companyId: null,
      staffPk: null,
      eventType: 'login_failed',
      ipAddress: clientIp,
      metadata: { username: String(username || '').trim(), app: 'salon-dashboard' },
    });
    return handleAuthError(res, err, 'Dashboard login failed');
  }
}
