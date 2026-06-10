import { pool } from '../../config/db.js';
import * as planRepo from '../repositories/plan.repository.js';

const REGISTRATION_SOFTWARE_TYPES = [
  {
    code: 'RESTAURANT',
    typeId: 1,
    name: 'Restaurant / HMS',
    description: 'Restaurant POS + ERP Backoffice. For restaurants, cafes, hotels, and bakeries.',
    includes: ['Restaurant POS (table management, KOT, billing)', 'Kitchen display & order flow', 'Full ERP Backoffice'],
  },
  {
    code: 'POS',
    typeId: 2,
    name: 'Counter POS / Retail',
    description: 'Counter POS + ERP Backoffice. For supermarkets, retail shops, and pharmacies.',
    includes: ['Counter POS (barcode, fast checkout)', 'Inventory & purchase management', 'Full ERP Backoffice'],
  },
  {
    code: 'ERP',
    typeId: null,
    name: 'ERP Backoffice Only',
    description: 'Full ERP without POS. For service businesses, wholesale, and trading companies.',
    includes: ['Sales & purchase management', 'Accounts & vouchers', 'Reports & dashboard'],
  },
];

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

export function listRegistrationOptions() {
  return {
    softwareTypes: REGISTRATION_SOFTWARE_TYPES,
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
