import { verifyAccessToken } from '../core/services/token.service.js';
import { pool } from '../config/db.js';
import { cacheGet, cacheSet, cacheDel } from '../config/redis.js';
import * as staffRepo from '../core/repositories/staff.repository.js';
import { resolveEntitlementsForStaff } from '../core/services/entitlement.service.js';
import { hasActiveSession } from '../core/services/authSession.service.js';

// Cache the staff session DTO so we don't hit the DB on every request.
// TTL kept short and <= access-token life so revocations take effect quickly.
const SESSION_TTL_SECONDS = 300;
const sessionKey = (staffPk) => `staffsess:${staffPk}`;

/**
 * Resolve the effective branch_id and station_id for a request.
 * - branch_id  → always the PHYSICAL location (from station_master.branch_id)
 * - station_id → software station; comes from JWT `sid` claim (POS device login)
 *                or from the station_master JOIN on the staff row (backoffice/restaurant)
 */
function resolveStaffContext(staffRow, jwtSid = null) {
  const physicalBranchId = staffRow.physical_branch_id ?? staffRow.branch_id;
  const stationId = jwtSid ?? staffRow.station_id ?? staffRow.branch_id;
  return {
    ...staffRow,
    branch_id:  Number(physicalBranchId),
    station_id: Number(stationId),
  };
}

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
    const staffPk  = Number(payload.sub);
    const jwtSid   = payload.sid != null ? Number(payload.sid) : null;
    const jwtScope = payload.scope ?? null;

    // POS tokens (scope: 'pos') must not access ERP routes — scope isolation.
    // Whitelist: POS namespaces + shared read-only lookup endpoints POS genuinely needs.
    const POS_ALLOWED_PREFIXES = ['/api/pos/', '/api/counter-pos/', '/api/salon-pos/'];
    // Shared catalogue endpoints every POS product needs to render its grid:
    // categories, the item list, the floor plan and customer lookup. Without
    // these a POS-scoped token can log in but the product grid, area strip and
    // chair/table picker all come back empty.
    //
    // Deliberately NOT whitelisted: /api/staff (backoffice staff administration
    // — POS gets its people from /api/<product>/staff-list and /stylists) and
    // anything under /api/accounts, /api/hr, /api/admin.
    const POS_ALLOWED_CATALOGUE = [
      '/api/groups',
      '/api/sub-groups',
      '/api/areas',
      '/api/tables',
      '/api/products',
      '/api/customers',
    ];
    const POS_ALLOWED_EXACT = ['/api/app-parameters/gvtax', '/api/parameters/POS'];
    // Compare against the PATH only. req.originalUrl carries the query string,
    // so matching a catalogue route needs the '?' stripped first
    // (e.g. '/api/products?groupId=1').
    const reqPath = req.originalUrl.split('?')[0];
    const isPosAllowed =
      POS_ALLOWED_PREFIXES.some(p => reqPath.startsWith(p))
      || POS_ALLOWED_EXACT.some(p => reqPath.startsWith(p))
      || POS_ALLOWED_CATALOGUE.some(p => reqPath === p || reqPath.startsWith(`${p}/`));
    if (jwtScope === 'pos' && !isPosAllowed) {
      return res.status(403).json({ message: 'POS token cannot access ERP routes' });
    }
    const sessionType = jwtScope === 'pos' ? 'pos' : 'erp';

    // Fast path: cached session (no DB round-trip). No-op miss when Redis off.
    const cached = await cacheGet(sessionKey(staffPk));
    if (cached) {
      const staffRow = JSON.parse(cached);
      if (!(await hasActiveSession(pool, staffPk, sessionType))) {
        await invalidateStaffSession(staffPk);
        return res.status(401).json({ message: 'Session expired' });
      }
      req.authStaff = {
        ...resolveStaffContext(staffRow, jwtSid),
        permissionSet:  new Set(staffRow.permission_codes || []),
        enabledFeatures: new Set(staffRow.feature_codes   || []),
      };
      req.access = staffRow.access || {
        subscription: { status: 'active', planCode: 'legacy', isUsable: true, mode: 'normal' },
        features: {},
        permissions: staffRow.permission_codes || [],
        limits: {},
        meta: { source: 'cached-session' },
      };
      if (req.access?.subscription?.isUsable === false) {
        return res.status(402).json({
          message: 'Subscription is not active',
          status: req.access.subscription.status,
          mode: req.access.subscription.mode,
        });
      }
      return next();
    }

    const { rows } = await staffRepo.findStaffSessionByPk(pool, staffPk);
    if (!rows.length) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    if (!(await hasActiveSession(pool, staffPk, sessionType))) {
      return res.status(401).json({ message: 'Session expired' });
    }
    const staffRow = rows[0];

    // Load role permissions and bake into session cache so requirePermission
    // can check them without an extra DB query on every request.
    let permission_codes = [];
    if (staffRow.role_id && staffRow.company_id) {
      const permRes = await pool.query(
        `SELECT permission_code FROM core.role_permission
         WHERE company_id = $1 AND role_id = $2 AND is_allowed = TRUE`,
        [staffRow.company_id, staffRow.role_id]
      );
      permission_codes = permRes.rows.map((r) => r.permission_code);
    }

    // Resolve and bake enabled features so requireFeature can check them
    // without a DB round-trip on every request. Features are company-scoped:
    // plan ∩ software-type scope + tenant overrides.
    let feature_codes = [];
    let entitlements = null;
    if (staffRow.company_id) {
      entitlements = await resolveEntitlementsForStaff(staffRow, pool);
      feature_codes = Object.entries(entitlements.features || {})
        .filter(([, enabled]) => enabled)
        .map(([code]) => code);
    }

    const access = entitlements || {
      subscription: { status: 'active', planCode: 'legacy', isUsable: true, mode: 'normal' },
      features: {},
      permissions: permission_codes,
      limits: {},
      meta: { source: 'no-company' },
    };
    const sessionData = { ...staffRow, permission_codes, feature_codes, access };
    await cacheSet(sessionKey(staffPk), JSON.stringify(sessionData), SESSION_TTL_SECONDS);
    req.authStaff = {
      ...resolveStaffContext(staffRow, jwtSid),
      permissionSet:  new Set(permission_codes),
      enabledFeatures: new Set(feature_codes),
    };
    req.access = access;
    if (req.access?.subscription?.isUsable === false) {
      return res.status(402).json({
        message: 'Subscription is not active',
        status: req.access.subscription.status,
        mode: req.access.subscription.mode,
      });
    }
    next();
  } catch {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}
