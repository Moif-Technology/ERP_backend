import * as planRepo from '../repositories/plan.repository.js';

function mapRowToPublicDto(row) {
  return {
    id: row.plan_code,
    name: row.display_name,
    audienceLabel: row.audience_label || undefined,
    description: row.description || '',
    priceMonthly: row.price_monthly_display,
    priceYearly: row.price_yearly_display || undefined,
    period: row.period_label,
    features: Array.isArray(row.features) ? row.features : [],
    cardNote: row.card_note || '',
    cta: row.cta_label || 'Get Started',
    popular: row.is_popular,
    trialDays: row.trial_days,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
}

export async function listPublicPlans(pool) {
  const { rows } = await planRepo.findActivePlans(pool);
  return { plans: rows.map(mapRowToPublicDto) };
}

export async function assertPlanAcceptsRegistration(pool, planCode) {
  const row = await planRepo.findActivePlanByCode(pool, planCode);
  if (!row) {
    const err = new Error('selectedPlan is invalid or not available');
    err.status = 400;
    throw err;
  }
  return row;
}
