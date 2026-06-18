import { verifyAccessToken } from '../core/services/token.service.js';
import { pool } from '../config/db.js';
import { cacheGet, cacheSet, cacheDel } from '../config/redis.js';
import * as staffRepo from '../core/repositories/staff.repository.js';

const OPEN_ACCESS = {
  subscription: { status: 'active', planCode: 'custom', isUsable: true, mode: 'normal' },
  features: new Proxy({}, { get: () => true }),
  permissions: new Proxy([], { get: (t, p) => p === 'includes' ? () => true : t[p] }),
  limits: {},
  meta: { source: 'open' },
};

// Cache the staff session DTO so we don't hit the DB on every request.
// TTL kept short and <= access-token life so revocations take effect quickly.
const SESSION_TTL_SECONDS = 300;
const sessionKey = (staffPk) => `staffsess:${staffPk}`;

/** Drop a cached session. Call after staff/role/permission changes + logout. */
export async function invalidateStaffSession(staffPk) {
  if (staffPk == null) return;
  await cacheDel(sessionKey(Number(staffPk)));
}

export async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    if (payload.typ !== 'access' || payload.sub == null) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const staffPk = Number(payload.sub);

    // Fast path: cached session (no DB round-trip). No-op miss when Redis off.
    const cached = await cacheGet(sessionKey(staffPk));
    if (cached) {
      req.authStaff = JSON.parse(cached);
      req.access = OPEN_ACCESS;
      return next();
    }

    const { rows } = await staffRepo.findStaffSessionByPk(pool, staffPk);
    if (!rows.length) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.authStaff = rows[0];
    await cacheSet(sessionKey(staffPk), JSON.stringify(rows[0]), SESSION_TTL_SECONDS);
    req.access = OPEN_ACCESS;
    next();
  } catch {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}
