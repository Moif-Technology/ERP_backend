/**
 * Data access for SaaS subscription entitlements.
 */

export async function findTenantSubscription(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT subscription_id, company_id, plan_code, status,
            trial_started_at, trial_ends_at, subscription_started_at,
            current_period_starts_at, current_period_ends_at, grace_ends_at,
            cancelled_at, suspended_at, suspension_reason
     FROM core.tenant_subscription
     WHERE company_id = $1
     LIMIT 1`,
    [companyId]
  );
  return rows[0] ?? null;
}

export async function findOnboardingSubscriptionFallback(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT company_id, plan_code, status, started_at AS trial_started_at, trial_ends_at
     FROM core.company_onboarding
     WHERE company_id = $1
     LIMIT 1`,
    [companyId]
  );
  return rows[0] ?? null;
}

export async function listPlanFeatures(pool, planCode) {
  const { rows } = await pool.query(
    `SELECT feature_code, is_enabled
     FROM core.plan_feature
     WHERE LOWER(plan_code) = LOWER($1)`,
    [planCode]
  );
  return rows;
}

export async function listTenantFeatureOverrides(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT feature_code, is_enabled
     FROM core.tenant_feature_override
     WHERE company_id = $1
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [companyId]
  );
  return rows;
}

export async function listPlanLimits(pool, planCode) {
  const { rows } = await pool.query(
    `SELECT limit_code, limit_value
     FROM core.plan_limit
     WHERE LOWER(plan_code) = LOWER($1)`,
    [planCode]
  );
  return rows;
}

export async function listTenantLimitOverrides(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT limit_code, limit_value
     FROM core.tenant_limit_override
     WHERE company_id = $1
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [companyId]
  );
  return rows;
}

export async function listRolePermissions(pool, companyId, roleId) {
  if (roleId == null) return [];
  const { rows } = await pool.query(
    `SELECT rp.permission_code, rp.is_allowed
     FROM core.role_permission rp
     JOIN core.permission_master pm
       ON pm.permission_code = rp.permission_code
      AND pm.is_active = TRUE
     WHERE rp.company_id = $1
       AND rp.role_id = $2`,
    [companyId, roleId]
  );
  return rows;
}

export async function getEntitlementVersion(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT GREATEST(
        COALESCE((SELECT MAX(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint FROM core.tenant_subscription WHERE company_id = $1), 0),
        COALESCE((SELECT MAX(EXTRACT(EPOCH FROM created_at) * 1000)::bigint FROM core.tenant_feature_override WHERE company_id = $1), 0),
        COALESCE((SELECT MAX(EXTRACT(EPOCH FROM created_at) * 1000)::bigint FROM core.tenant_limit_override WHERE company_id = $1), 0),
        COALESCE((SELECT MAX(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint FROM core.role_permission WHERE company_id = $1), 0),
        COALESCE((SELECT MAX(EXTRACT(EPOCH FROM modified_at) * 1000)::bigint FROM core.staff_master WHERE company_id = $1), 0),
        COALESCE((SELECT MAX(EXTRACT(EPOCH FROM modified_at) * 1000)::bigint FROM core.role_master WHERE company_id = $1), 0),
        COALESCE((SELECT MAX(EXTRACT(EPOCH FROM created_at) * 1000)::bigint FROM core.subscription_audit_log WHERE company_id = $1), 0)
      ) AS version`,
    [companyId]
  );
  return Number(rows[0]?.version || 0);
}
