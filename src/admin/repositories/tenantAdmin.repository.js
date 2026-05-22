import { pool } from '../../config/db.js';

export async function listTenants({ status, search, limit = 100, offset = 0 } = {}) {
  const params = [];
  const where = [];
  if (status) {
    params.push(status);
    where.push(`COALESCE(ts.status, 'trial') = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(c.company_name ILIKE $${params.length} OR c.company_id::text ILIKE $${params.length})`);
  }
  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT c.company_id,
            c.company_name,
            NULL::text AS email,
            NULL::text AS phone,
            ts.plan_code,
            ts.status,
            ts.trial_ends_at,
            ts.current_period_ends_at,
            ts.suspended_at,
            ts.cancelled_at
       FROM core.company_master c
       LEFT JOIN core.tenant_subscription ts ON ts.company_id = c.company_id
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
            ts.subscription_id, ts.plan_code, ts.status,
            ts.trial_started_at, ts.trial_ends_at,
            ts.subscription_started_at, ts.current_period_starts_at,
            ts.current_period_ends_at, ts.grace_ends_at,
            ts.suspended_at, ts.cancelled_at, ts.suspension_reason
       FROM core.company_master c
       LEFT JOIN core.tenant_subscription ts ON ts.company_id = c.company_id
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

  const insertCols = ['company_id', ...patchEntries.map(([col]) => col)];
  const params = [companyId, ...patchEntries.map(([, val]) => val)];
  const insertVals = insertCols.map((_, idx) => `$${idx + 1}`);
  const updateSet = patchEntries.map(([col]) => `${col} = EXCLUDED.${col}`);

  const { rows } = await pool.query(
    `INSERT INTO core.tenant_subscription (${insertCols.join(', ')})
     VALUES (${insertVals.join(', ')})
     ON CONFLICT (company_id)
     DO UPDATE SET
       ${updateSet.join(', ')},
       updated_at = NOW()
     RETURNING *`,
    params
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
