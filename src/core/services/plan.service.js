import { pool } from '../../config/db.js';
import * as planRepo from '../repositories/plan.repository.js';

/**
 * Marketing bullets for the signup cards, keyed by software_code.
 *
 * The LIST of software types is NOT defined here — it comes from
 * core.software_type_master (see listRegistrationOptions). This map only
 * decorates it. A code with no entry still appears on the signup page using the
 * name and description stored in the table; it just shows no bullet list.
 *
 * That split matters: the previous version hardcoded the whole list and ended at
 * CRM, so SERVICE (added 2026-07-20) and SALON (added 2026-07-28) were invisible
 * on the signup page even though both existed in the table and had features
 * scoped to them. Adding a software type is now a data change, not a code change.
 */
const SOFTWARE_TYPE_HIGHLIGHTS = {
  RESTAURANT: ['Restaurant POS (table management, KOT, billing)', 'Kitchen display & order flow', 'Full ERP Backoffice'],
  POS:        ['Counter POS (barcode, fast checkout)', 'Inventory & purchase management', 'Full ERP Backoffice'],
  ERP:        ['Sales & purchase management', 'Accounts & vouchers', 'Reports & dashboard'],
  GARAGE:     ['Job cards, estimates & gate pass', 'Technicians & parts usage', 'ERP Backoffice'],
  HR:         ['Employees & documents', 'Attendance & shifts', 'Leave management'],
  CRM:        ['Leads & opportunities', 'Follow-ups & interactions', 'CRM reports'],
  SERVICE:    ['Service jobs & case tracking', 'Job status & assignment', 'ERP Backoffice'],
  SALON:      ['Salon POS (chairs, service jobs, billing)', 'Per-stylist assignment & commission', 'Retail products alongside services'],
};

const REGISTRATION_DESIGNATIONS = [
  'CEO / Owner',
  'Managing Director',
  'General Manager',
  'Operations Manager',
  'Finance Manager',
  'IT Manager',
  'Sales Manager',
  'Purchase Manager',
  'HR Manager',
  'Administrator',
  'Accountant',
  'Other',
];

export async function listRegistrationOptions() {
  const rows = await planRepo.listActiveSoftwareTypes(pool);
  return {
    softwareTypes: rows.map((r) => ({
      code: r.software_code,
      typeId: Number(r.software_type_id),
      name: r.software_name,
      description: r.description ?? '',
      includes: SOFTWARE_TYPE_HIGHLIGHTS[r.software_code] ?? [],
    })),
    designations: REGISTRATION_DESIGNATIONS,
  };
}

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
