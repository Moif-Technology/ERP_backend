import * as tenantService from '../services/tenant.service.js';
import { pool } from '../../config/db.js';
import { invalidateStaffSession } from '../../middleware/authMiddleware.js';

function actorId(req) {
  return req.platformUser?.platformUserId || null;
}

function handle(err, res) {
  return res.status(err.status || 500).json({ message: err.message });
}

export async function list(req, res) {
  try {
    const { status, search, limit, offset } = req.query;
    const rows = await tenantService.listTenants({
      status,
      search,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return res.json({ tenants: rows });
  } catch (err) {
    return handle(err, res);
  }
}

export async function detail(req, res) {
  try {
    const data = await tenantService.getTenantDetail(Number(req.params.companyId));
    return res.json(data);
  } catch (err) {
    return handle(err, res);
  }
}

export async function patchSubscription(req, res) {
  try {
    const after = await tenantService.updateSubscription({
      companyId: Number(req.params.companyId),
      patch: req.body || {},
      actorPlatformUserId: actorId(req),
    });
    return res.json({ subscription: after });
  } catch (err) {
    return handle(err, res);
  }
}

export async function getFeatures(req, res) {
  try {
    const companyId = Number(req.params.companyId);

    const [featuresRes, planRes, overridesRes, subRes] = await Promise.all([
      pool.query(`
        SELECT feature_code, feature_name, pack_code, feature_type, sort_order, is_active
        FROM core.feature_master
        WHERE is_active = TRUE
        ORDER BY sort_order, feature_code
      `),
      pool.query(`
        SELECT pf.feature_code, pf.is_enabled
        FROM core.plan_feature pf
        JOIN core.plan_master pm ON pm.plan_code = pf.plan_code
        JOIN (
          SELECT COALESCE(ts.plan_code, ob.plan_code) AS plan_code
          FROM core.company_master c
          LEFT JOIN core.tenant_subscription ts ON ts.company_id = c.company_id
          LEFT JOIN core.company_onboarding ob ON ob.company_id = c.company_id
          WHERE c.company_id = $1
          LIMIT 1
        ) sub ON sub.plan_code = pm.plan_code
      `, [companyId]),
      pool.query(
        `SELECT feature_code, is_enabled, reason FROM core.tenant_feature_override WHERE company_id = $1`,
        [companyId]
      ),
      pool.query(`
        SELECT COALESCE(ts.plan_code, ob.plan_code) AS plan_code
        FROM core.company_master c
        LEFT JOIN core.tenant_subscription ts ON ts.company_id = c.company_id
        LEFT JOIN core.company_onboarding ob ON ob.company_id = c.company_id
        WHERE c.company_id = $1
        LIMIT 1
      `, [companyId]),
    ]);

    const planCode = subRes.rows[0]?.plan_code || null;
    const planMap = {};
    for (const r of planRes.rows) planMap[r.feature_code] = r.is_enabled;
    const overrideMap = {};
    for (const r of overridesRes.rows) overrideMap[r.feature_code] = { isEnabled: r.is_enabled, reason: r.reason };

    const allFeatures = featuresRes.rows;
    const packs = allFeatures.filter((f) => f.feature_type === 'pack');
    const children = allFeatures.filter((f) => f.feature_type !== 'pack');

    const tree = packs
      .map((pack) => ({
        ...pack,
        children: children
          .filter((f) => f.pack_code === pack.feature_code)
          .map((f) => ({
            ...f,
            planEnabled: planMap[f.feature_code] ?? false,
            override: overrideMap[f.feature_code] ?? null,
            effective: overrideMap[f.feature_code] != null
              ? overrideMap[f.feature_code].isEnabled
              : (planMap[f.feature_code] ?? false),
          })),
      }))
      .filter((p) => p.children.length > 0);

    return res.json({ tree, planCode, overrideCount: overridesRes.rows.length });
  } catch (err) {
    return handle(err, res);
  }
}

export async function setFeature(req, res) {
  try {
    const after = await tenantService.setFeatureOverride({
      companyId: Number(req.params.companyId),
      featureCode: req.body?.featureCode,
      isEnabled: !!req.body?.isEnabled,
      reason: req.body?.reason,
      expiresAt: req.body?.expiresAt,
      actorPlatformUserId: actorId(req),
    });
    return res.json({ override: after });
  } catch (err) {
    return handle(err, res);
  }
}

export async function clearFeature(req, res) {
  try {
    await tenantService.clearFeatureOverride({
      companyId: Number(req.params.companyId),
      featureCode: req.params.featureCode,
      actorPlatformUserId: actorId(req),
    });
    return res.json({ ok: true });
  } catch (err) {
    return handle(err, res);
  }
}

export async function clearLimit(req, res) {
  try {
    await tenantService.clearLimitOverride({
      companyId: Number(req.params.companyId),
      limitCode: req.params.limitCode,
      actorPlatformUserId: actorId(req),
    });
    return res.json({ ok: true });
  } catch (err) {
    return handle(err, res);
  }
}

export async function setLimit(req, res) {
  try {
    const after = await tenantService.setLimitOverride({
      companyId: Number(req.params.companyId),
      limitCode: req.body?.limitCode,
      limitValue: Number(req.body?.limitValue),
      reason: req.body?.reason,
      expiresAt: req.body?.expiresAt,
      actorPlatformUserId: actorId(req),
    });
    return res.json({ override: after });
  } catch (err) {
    return handle(err, res);
  }
}

export async function suspend(req, res) {
  try {
    const after = await tenantService.suspendTenant({
      companyId: Number(req.params.companyId),
      reason: req.body?.reason,
      actorPlatformUserId: actorId(req),
    });
    return res.json({ subscription: after });
  } catch (err) {
    return handle(err, res);
  }
}

export async function reactivate(req, res) {
  try {
    const after = await tenantService.reactivateTenant({
      companyId: Number(req.params.companyId),
      actorPlatformUserId: actorId(req),
    });
    return res.json({ subscription: after });
  } catch (err) {
    return handle(err, res);
  }
}

export async function extendTrial(req, res) {
  try {
    const after = await tenantService.extendTrial({
      companyId: Number(req.params.companyId),
      days: Number(req.body?.days || 0),
      actorPlatformUserId: actorId(req),
    });
    return res.json({ subscription: after });
  } catch (err) {
    return handle(err, res);
  }
}

export async function audit(req, res) {
  try {
    const rows = await tenantService.listAuditLog(Number(req.params.companyId), {
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    return res.json({ entries: rows });
  } catch (err) {
    return handle(err, res);
  }
}

export async function sessions(req, res) {
  try {
    const companyId = Number(req.params.companyId);
    const [activeRes, eventsRes] = await Promise.all([
      pool.query(
        `SELECT staff_pk, session_type, created_at, expires_at
         FROM core.active_session
         WHERE company_id = $1 AND expires_at > NOW()
         ORDER BY created_at DESC`,
        [companyId]
      ),
      pool.query(
        `SELECT id, staff_pk, event_type, ip_address, metadata, created_at
         FROM core.auth_event_log
         WHERE company_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [companyId]
      ),
    ]);
    return res.json({ activeSessions: activeRes.rows, authEvents: eventsRes.rows });
  } catch (err) {
    return handle(err, res);
  }
}

export async function killSession(req, res) {
  try {
    const companyId = Number(req.params.companyId);
    const staffPk   = Number(req.params.staffPk);
    const { sessionType } = req.params;

    const { rowCount } = await pool.query(
      'DELETE FROM core.active_session WHERE staff_pk = $1 AND session_type = $2 AND company_id = $3',
      [staffPk, sessionType, companyId]
    );
    if (rowCount === 0) {
      return res.status(404).json({ message: 'Session not found or already expired' });
    }
    await invalidateStaffSession(staffPk);
    return res.json({ ok: true });
  } catch (err) {
    return handle(err, res);
  }
}

export async function killAllSessions(req, res) {
  try {
    const companyId = Number(req.params.companyId);

    const { rows } = await pool.query(
      'DELETE FROM core.active_session WHERE company_id = $1 RETURNING staff_pk',
      [companyId]
    );
    await Promise.all(rows.map((r) => invalidateStaffSession(r.staff_pk)));
    return res.json({ ok: true, killed: rows.length });
  } catch (err) {
    return handle(err, res);
  }
}
