/**
 * Data access for core.company_onboarding.
 */

export async function findOnboardingWithPlanByCompanyId(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT o.company_id, o.plan_code, o.status, o.started_at, o.trial_ends_at,
            o.welcome_completed_at,
            p.display_name, p.audience_label, p.description,
            p.price_monthly_display, p.price_yearly_display, p.period_label,
            p.features
     FROM core.company_onboarding o
     LEFT JOIN core.plan_master p ON LOWER(TRIM(p.plan_code)) = LOWER(TRIM(o.plan_code))
     WHERE o.company_id = $1
     LIMIT 1`,
    [companyId]
  );
  return rows[0] ?? null;
}

export async function markWelcomeCompleted(pool, companyId) {
  const { rowCount } = await pool.query(
    `UPDATE core.company_onboarding
     SET welcome_completed_at = NOW(), updated_at = NOW()
     WHERE company_id = $1`,
    [companyId]
  );
  return rowCount;
}

export async function insertTrialOnboarding(client, params) {
  const { companyId, planCode, now, trialEndsAt, onboardingJson } = params;
  await client.query(
    `INSERT INTO core.company_onboarding (
      company_id, plan_code, status, started_at, trial_ends_at, onboarding_json, created_at, updated_at
    ) VALUES ($1, $2, 'TRIAL', $3, $4, $5, $3, $3)`,
    [companyId, planCode, now, trialEndsAt, onboardingJson]
  );
}

// core.tenant_subscription is what the super-admin tenant screens and the
// entitlement resolve read first; company_onboarding is only a fallback.
// Registration must create both or new tenants show "Plan: None" in admin.
export async function insertTrialSubscription(client, params) {
  const { companyId, planCode, now, trialEndsAt } = params;
  await client.query(
    `INSERT INTO core.tenant_subscription (
      company_id, plan_code, status, trial_started_at, trial_ends_at, created_at, updated_at
    ) VALUES ($1, $2, 'trial', $3, $4, $3, $3)
    ON CONFLICT (company_id) DO UPDATE SET
      plan_code = EXCLUDED.plan_code,
      status = EXCLUDED.status,
      trial_started_at = EXCLUDED.trial_started_at,
      trial_ends_at = EXCLUDED.trial_ends_at,
      updated_at = EXCLUDED.updated_at`,
    [companyId, planCode, now, trialEndsAt]
  );
}
