import * as onboardingRepo from '../repositories/onboarding.repository.js';

/**
 * ERP first-login screen payload (plan snapshot). show=false when no row or already completed.
 */
export function mapOnboardingRowToWelcome(row) {
  if (!row || row.welcome_completed_at != null) {
    return { show: false };
  }
  const features = Array.isArray(row.features) ? row.features : [];
  return {
    show: true,
    planCode: row.plan_code,
    planName: row.display_name || String(row.plan_code || 'Plan'),
    audienceLabel: row.audience_label || null,
    description: row.description || '',
    status: row.status,
    trialEndsAt: row.trial_ends_at,
    startedAt: row.started_at,
    priceMonthly: row.price_monthly_display || null,
    priceYearly: row.price_yearly_display || null,
    periodLabel: row.period_label || null,
    featurePreview: features.slice(0, 8),
  };
}

export async function buildWelcomeForSession(pool, companyId) {
  const cid = Number(companyId);
  if (!Number.isFinite(cid)) {
    return { show: false };
  }
  const row = await onboardingRepo.findOnboardingWithPlanByCompanyId(pool, cid);
  return mapOnboardingRowToWelcome(row);
}
