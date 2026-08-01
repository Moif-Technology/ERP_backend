import { pool } from '../../config/db.js';

export async function listTenants({ status, search, limit = 100, offset = 0 } = {}) {
  const params = [];
  const where = [];
  if (status) {
    params.push(status);
    where.push(`COALESCE(ts.status, LOWER(ob.status), 'trial') = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(c.company_name ILIKE $${params.length} OR c.company_id::text ILIKE $${params.length})`);
  }
  params.push(limit, offset);
  // company_onboarding is the registration-time fallback for tenants that
  // predate the tenant_subscription insert in registration.
  const { rows } = await pool.query(
    `SELECT c.company_id,
            c.company_name,
            NULL::text AS email,
            NULL::text AS phone,
            stm.software_code AS software_type_code,
            stm.software_name AS software_type_name,
            COALESCE(ts.plan_code, ob.plan_code) AS plan_code,
            COALESCE(ts.status, LOWER(ob.status)) AS status,
            COALESCE(ts.trial_ends_at, ob.trial_ends_at) AS trial_ends_at,
            ts.current_period_ends_at,
            ts.suspended_at,
            ts.cancelled_at
       FROM core.company_master c
       LEFT JOIN core.tenant_subscription ts ON ts.company_id = c.company_id
       LEFT JOIN core.company_onboarding ob ON ob.company_id = c.company_id
       LEFT JOIN core.software_type_master stm ON stm.software_type_id = c.software_type_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY c.company_id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

export async function getTenant(companyId) {
  const { rows } = await pool.query(
    `SELECT c.company_id, c.company_name, NULL::text AS email, NULL::text AS phone, c.company_address,
            c.business_variant,
            stm.software_code AS software_type_code,
            stm.software_name AS software_type_name,
            ts.subscription_id,
            COALESCE(ts.plan_code, ob.plan_code) AS plan_code,
            COALESCE(ts.status, LOWER(ob.status)) AS status,
            COALESCE(ts.trial_started_at, ob.started_at) AS trial_started_at,
            COALESCE(ts.trial_ends_at, ob.trial_ends_at) AS trial_ends_at,
            ts.subscription_started_at, ts.current_period_starts_at,
            ts.current_period_ends_at, ts.grace_ends_at,
            ts.suspended_at, ts.cancelled_at, ts.suspension_reason
       FROM core.company_master c
       LEFT JOIN core.tenant_subscription ts ON ts.company_id = c.company_id
       LEFT JOIN core.company_onboarding ob ON ob.company_id = c.company_id
       LEFT JOIN core.software_type_master stm ON stm.software_type_id = c.software_type_id
      WHERE c.company_id = $1`,
    [companyId]
  );
  return rows[0] || null;
}

export async function listFeatureOverrides(companyId) {
  const { rows } = await pool.query(
    `SELECT feature_code, is_enabled, reason, expires_at
       FROM core.tenant_feature_override
      WHERE company_id = $1`,
    [companyId]
  );
  return rows;
}

export async function listLimitOverrides(companyId) {
  const { rows } = await pool.query(
    `SELECT limit_code, limit_value, reason, expires_at
       FROM core.tenant_limit_override
      WHERE company_id = $1`,
    [companyId]
  );
  return rows;
}

export async function upsertSubscription(companyId, patch) {
  const patchEntries = Object.entries(patch || {});

  if (patchEntries.length === 0) {
    const existing = await pool.query(
      `SELECT *
         FROM core.tenant_subscription
        WHERE company_id = $1`,
      [companyId]
    );
    return existing.rows[0] || null;
  }

  // UPDATE first: an INSERT ... ON CONFLICT would fail the plan_code NOT NULL
  // check on the proposed row whenever the patch doesn't include plan_code,
  // even when a conflicting row already exists.
  const updateParams = [companyId, ...patchEntries.map(([, val]) => val)];
  const updateSet = patchEntries.map(([col], idx) => `${col} = $${idx + 2}`);
  const updated = await pool.query(
    `UPDATE core.tenant_subscription
        SET ${updateSet.join(', ')},
            updated_at = NOW()
      WHERE company_id = $1
      RETURNING *`,
    updateParams
  );
  if (updated.rows[0]) return updated.rows[0];

  // No subscription row yet — insert one. plan_code is NOT NULL, so fall back
  // to the registration-time plan from company_onboarding, then 'basic'.
  const patchMap = Object.fromEntries(patchEntries);
  if (!patchMap.plan_code) {
    const ob = await pool.query(
      `SELECT plan_code FROM core.company_onboarding WHERE company_id = $1`,
      [companyId]
    );
    patchMap.plan_code = ob.rows[0]?.plan_code || 'basic';
  }
  const insertEntries = Object.entries(patchMap);
  const insertCols = ['company_id', ...insertEntries.map(([col]) => col)];
  const insertParams = [companyId, ...insertEntries.map(([, val]) => val)];
  const insertVals = insertCols.map((_, idx) => `$${idx + 1}`);

  const { rows } = await pool.query(
    `INSERT INTO core.tenant_subscription (${insertCols.join(', ')})
     VALUES (${insertVals.join(', ')})
     ON CONFLICT (company_id)
     DO UPDATE SET
       ${insertEntries.map(([col]) => `${col} = EXCLUDED.${col}`).join(', ')},
       updated_at = NOW()
     RETURNING *`,
    insertParams
  );

  return rows[0] || null;
}

export async function upsertFeatureOverride({ companyId, featureCode, isEnabled, reason, expiresAt, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO core.tenant_feature_override
       (company_id, feature_code, is_enabled, reason, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (company_id, feature_code)
     DO UPDATE SET is_enabled = EXCLUDED.is_enabled,
                   reason = EXCLUDED.reason,
                   expires_at = EXCLUDED.expires_at,
                   created_by = EXCLUDED.created_by
     RETURNING *`,
    [companyId, featureCode, isEnabled, reason || null, expiresAt || null, createdBy || null]
  );
  return rows[0];
}

export async function deleteFeatureOverride(companyId, featureCode) {
  const { rows } = await pool.query(
    `DELETE FROM core.tenant_feature_override
      WHERE company_id = $1 AND feature_code = $2
     RETURNING *`,
    [companyId, featureCode]
  );
  return rows[0] || null;
}

export async function deleteLimitOverride(companyId, limitCode) {
  const { rows } = await pool.query(
    `DELETE FROM core.tenant_limit_override
      WHERE company_id = $1 AND limit_code = $2
     RETURNING *`,
    [companyId, limitCode]
  );
  return rows[0] || null;
}

export async function upsertLimitOverride({ companyId, limitCode, limitValue, reason, expiresAt, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO core.tenant_limit_override
       (company_id, limit_code, limit_value, reason, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (company_id, limit_code)
     DO UPDATE SET limit_value = EXCLUDED.limit_value,
                   reason = EXCLUDED.reason,
                   expires_at = EXCLUDED.expires_at,
                   created_by = EXCLUDED.created_by
     RETURNING *`,
    [companyId, limitCode, limitValue, reason || null, expiresAt || null, createdBy || null]
  );
  return rows[0];
}

export async function appendAuditLog({ companyId, actorPlatformUserId, action, entityType, entityId, beforeJson, afterJson }) {
  await pool.query(
    `INSERT INTO core.subscription_audit_log
       (company_id, actor_user_id, action, entity_type, entity_id, before_json, after_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      companyId,
      actorPlatformUserId || null,
      action,
      entityType,
      entityId || null,
      beforeJson ? JSON.stringify(beforeJson) : null,
      afterJson ? JSON.stringify(afterJson) : null,
    ]
  );
}

export async function listAuditLog(companyId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT audit_id, company_id, actor_user_id, action, entity_type, entity_id,
            before_json, after_json, created_at
       FROM core.subscription_audit_log
      WHERE company_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [companyId, limit, offset]
  );
  return rows;
}

export async function updateBusinessVariant(companyId, businessVariant) {
  const { rows } = await pool.query(
    `UPDATE core.company_master
       SET business_variant = $1, updated_at = NOW()
      WHERE company_id = $2
      RETURNING business_variant`,
    [businessVariant, companyId]
  );
  return rows[0]?.business_variant || null;
}
