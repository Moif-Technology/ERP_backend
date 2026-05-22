/**
 * Seed test tenants as full registrations — company, branch, roles, staff, onboarding,
 * subscription, and feature/limit overrides. Every tenant gets a loginable admin user.
 *
 * Usage:  node scripts/seed-test-tenants.mjs
 *
 * Login:  <fixture_code_lowercase>@test.local  /  1234567890
 * e.g.    t_resto_basic@test.local  /  1234567890
 *
 * Idempotent: skips registration if staff email already exists, then upserts
 * subscription + overrides on top of the existing company.
 *
 * Plan defaults (from 044_core_entitlements.sql):
 *   basic    = limited pos + limited backoffice only
 *   standard = full pos + full backoffice  (no hr / crm / garage)
 *   pro      = full pos + full backoffice + hr + crm  (no garage)
 *   custom   = everything including garage
 *
 * Feature overrides disable (false) or force-enable (true) a module on top of the plan.
 * Disabling the pack root (e.g. 'pos') hides all its child features in the sidebar.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const TEST_PASSWORD = '1234567890';

const FIXTURES = [
  // Case 1 — Small restaurant: backoffice only, no POS (basic plan)
  {
    code: 'T_RESTO_BASIC',
    companyName: 'Test Restaurant Basic (Backoffice only)',
    planCode: 'basic',
    status: 'active',
    overrides: { features: { pos: false }, limits: {} },
  },

  // Case 2 — Medium restaurant: full backoffice + POS (standard plan)
  {
    code: 'T_RESTO_STANDARD',
    companyName: 'Test Restaurant Standard (Backoffice + POS)',
    planCode: 'standard',
    status: 'active',
    overrides: { features: {}, limits: {} },
  },

  // Case 3 — Full restaurant: backoffice + POS + HR + CRM (pro plan)
  {
    code: 'T_RESTO_PRO',
    companyName: 'Test Restaurant Pro (Backoffice + POS + HR + CRM)',
    planCode: 'pro',
    status: 'active',
    overrides: { features: {}, limits: { pos_counters: 4 } },
  },

  // Case 4 — Restaurant with staff management, no POS: backoffice + HR (pro, disable pos+crm)
  {
    code: 'T_BACKOFFICE_HR',
    companyName: 'Test Backoffice + HR (no POS)',
    planCode: 'pro',
    status: 'active',
    overrides: { features: { pos: false, crm: false }, limits: {} },
  },

  // Case 5 — Trading company: backoffice + CRM (pro, disable pos+hr)
  {
    code: 'T_BACKOFFICE_CRM',
    companyName: 'Test Backoffice + CRM (Trading)',
    planCode: 'pro',
    status: 'active',
    overrides: { features: { pos: false, hr: false }, limits: {} },
  },

  // Case 6 — Auto workshop: garage + HR only (custom, disable backoffice+pos+crm)
  {
    code: 'T_GARAGE_ONLY',
    companyName: 'Test Garage + HR Only (Workshop)',
    planCode: 'custom',
    status: 'active',
    overrides: { features: { backoffice: false, pos: false, crm: false }, limits: {} },
  },

  // Case 7 — Workshop + parts: backoffice + garage (custom, disable pos+hr+crm)
  {
    code: 'T_GARAGE_BACKOFFICE',
    companyName: 'Test Garage + Backoffice (Workshop+Parts)',
    planCode: 'custom',
    status: 'active',
    overrides: { features: { pos: false, hr: false, crm: false }, limits: {} },
  },

  // Case 8 — HR only company (pro, disable backoffice+pos+crm)
  {
    code: 'T_HR_ONLY',
    companyName: 'Test HR Only',
    planCode: 'pro',
    status: 'active',
    overrides: { features: { backoffice: false, pos: false, crm: false }, limits: {} },
  },

  // Case 9 — Full suite: all modules (custom, no overrides)
  {
    code: 'T_FULL_SUITE',
    companyName: 'Test Full Suite (All Modules)',
    planCode: 'custom',
    status: 'active',
    overrides: { features: {}, limits: {} },
  },

  // Subscription state tests (still loginable, just subscription blocked)
  {
    code: 'T_EXPIRED',
    companyName: 'Test Expired Tenant',
    planCode: 'basic',
    status: 'expired',
    overrides: { features: {}, limits: {} },
    trialEndsDaysOffset: -7,
  },
  {
    code: 'T_SUSPENDED',
    companyName: 'Test Suspended Tenant',
    planCode: 'basic',
    status: 'suspended',
    overrides: { features: {}, limits: {} },
    suspensionReason: 'Non-payment (test fixture)',
  },
];

// ─── helpers ────────────────────────────────────────────────────────────────

function sanitizeCompanyCode(name, companyId) {
  const base = String(name || '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .slice(0, 24)
    .toUpperCase();
  const prefix = base || 'CO';
  let code = `${prefix}${companyId}`;
  if (code.length > 50) code = code.slice(0, 50);
  return code;
}

async function findCompanyIdByStaffEmail(client, email) {
  const { rows } = await client.query(
    `SELECT company_id FROM core.staff_master
     WHERE LOWER(login_name) = LOWER($1) LIMIT 1`,
    [email]
  );
  return rows[0]?.company_id ?? null;
}

// ─── full registration (mirrors registration.service.js) ────────────────────

async function registerTenant(client, fixture) {
  const email = `${fixture.code.toLowerCase()}@test.local`;

  // idempotency: skip if admin user already created
  const existing = await findCompanyIdByStaffEmail(client, email);
  if (existing) {
    console.log(`  already registered → company_id=${existing}`);
    return existing;
  }

  // allocate company_id
  const { rows: cidRows } = await client.query(
    'SELECT COALESCE(MAX(company_id), 0) + 1 AS company_id FROM core.company_master'
  );
  const companyId = Number(cidRows[0].company_id);

  // unique company_code
  let companyCode = sanitizeCompanyCode(fixture.companyName, companyId);
  const { rows: codeCheck } = await client.query(
    'SELECT 1 FROM core.company_master WHERE company_code = $1 LIMIT 1',
    [companyCode]
  );
  if (codeCheck.length) companyCode = `C${companyId}`;

  const now = new Date().toISOString();
  const contactPerson = `Test Admin (${fixture.code})`;

  // 1. company_master
  await client.query(
    `INSERT INTO core.company_master (
       company_id, company_code, company_name, company_address, status,
       contact_person, phone, created_at, updated_at
     ) VALUES ($1, $2, $3, NULL, 'ACTIVE', $4, '0000000000', $5, $5)`,
    [companyId, companyCode, fixture.companyName, contactPerson, now]
  );

  // 2. head office branch (branch_id = 1)
  await client.query(
    `INSERT INTO core.branch_master (
       company_id, branch_id, branch_code, branch_name, status, created_at, updated_at
     ) VALUES ($1, 1, 'HQ', 'Head Office', 'ACTIVE', $2, $2)`,
    [companyId, now]
  );

  // 3. default roles: Admin(1), Staff(2), Cashier(3), Inventory(4), Accountant(5)
  const DEFAULT_ROLES = [
    [1, 'Admin', 100],
    [2, 'Staff', 0],
    [3, 'Cashier', 0],
    [4, 'Inventory', 0],
    [5, 'Accountant', 0],
  ];
  for (const [roleId, roleName, discount] of DEFAULT_ROLES) {
    await client.query(
      `INSERT INTO core.role_master (
         company_id, role_id, role_name, discount_percent_allowed,
         software_type, created_by, modified_by
       ) VALUES ($1, $2, $3, $4, 'ERP', 'seed', 'seed')
       ON CONFLICT (company_id, role_id) DO NOTHING`,
      [companyId, roleId, roleName, discount]
    );
  }

  // Admin role gets all permissions
  await client.query(
    `INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
     SELECT $1, 1, permission_code, TRUE
     FROM core.permission_master WHERE is_active = TRUE
     ON CONFLICT (company_id, role_id, permission_code)
     DO UPDATE SET is_allowed = TRUE, updated_at = NOW()`,
    [companyId]
  );

  // Staff role: view-only on common features
  await client.query(
    `INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
     SELECT $1, 2, permission_code, TRUE
     FROM core.permission_master
     WHERE action_code = 'view'
       AND feature_code IN (
         'core.company_profile', 'core.customers', 'core.suppliers',
         'backoffice.dashboard', 'backoffice.reports'
       )
     ON CONFLICT (company_id, role_id, permission_code)
     DO UPDATE SET is_allowed = TRUE, updated_at = NOW()`,
    [companyId]
  );

  // Cashier role permissions
  await client.query(
    `INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
     SELECT $1, 3, pm.permission_code, TRUE
     FROM core.permission_master pm
     WHERE pm.permission_code = ANY($2::varchar[])
     ON CONFLICT (company_id, role_id, permission_code)
     DO UPDATE SET is_allowed = TRUE, updated_at = NOW()`,
    [companyId, [
      'pos.billing.view', 'pos.billing.create', 'pos.kot.view', 'pos.kot.create',
      'pos.settlement.view', 'pos.settlement.create', 'pos.tables.view',
      'pos.customer_selection.view', 'pos.product_search.view', 'pos.discount.view',
    ]]
  );

  // Inventory role permissions
  await client.query(
    `INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
     SELECT $1, 4, permission_code, TRUE
     FROM core.permission_master
     WHERE feature_code IN (
       'backoffice.inventory', 'backoffice.product_master', 'backoffice.product_group',
       'backoffice.stock_entry', 'backoffice.stock_adjustment', 'backoffice.damage_entry',
       'backoffice.purchase', 'backoffice.purchase_order', 'backoffice.grn',
       'backoffice.suppliers'
     )
     ON CONFLICT (company_id, role_id, permission_code)
     DO UPDATE SET is_allowed = TRUE, updated_at = NOW()`,
    [companyId]
  );

  // Accountant role permissions
  await client.query(
    `INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
     SELECT $1, 5, permission_code, TRUE
     FROM core.permission_master
     WHERE feature_code IN (
       'backoffice.accounts', 'backoffice.vouchers', 'backoffice.sales',
       'backoffice.sales_quotation', 'backoffice.delivery_order', 'backoffice.reports'
     )
     ON CONFLICT (company_id, role_id, permission_code)
     DO UPDATE SET is_allowed = TRUE, updated_at = NOW()`,
    [companyId]
  );

  // 4. admin staff user
  const { rows: sidRows } = await client.query(
    'SELECT COALESCE(MAX(staff_id), 0) + 1 AS staff_id FROM core.staff_master WHERE company_id = $1',
    [companyId]
  );
  const staffId = Number(sidRows[0].staff_id);
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

  await client.query(
    `INSERT INTO core.staff_master (
       company_id, staff_id, branch_id, staff_code, staff_name, designation,
       login_name, password_hash, role_id, duty_status, mobile_no, email,
       sync_status, server_status, record_status,
       created_at, created_by, modified_at, modified_by, created_by_staff_id
     ) VALUES (
       $1, $2, 1, $3, $4, 'Admin',
       $5, $6, 1, NULL, NULL, $5,
       'PENDING', 'PENDING', 'ACTIVE',
       $7, 'seed', $7, 'seed', NULL
     )`,
    [companyId, staffId, `U${staffId}`, contactPerson, email, passwordHash, now]
  );

  // 5. onboarding record
  const trialEnds = new Date(Date.now() + 30 * 86400 * 1000).toISOString();
  await client.query(
    `INSERT INTO core.company_onboarding (
       company_id, plan_code, status, started_at, trial_ends_at,
       onboarding_json, created_at, updated_at
     ) VALUES ($1, $2, 'TRIAL', $3, $4, $5, $3, $3)
     ON CONFLICT (company_id) DO NOTHING`,
    [companyId, fixture.planCode, now, trialEnds,
     JSON.stringify({ business_type: 'test', setup_blueprint: null })]
  );

  return companyId;
}

// ─── subscription + overrides ────────────────────────────────────────────────

async function upsertSubscription(client, companyId, fixture) {
  const trialEnds = fixture.trialEndsDaysOffset
    ? new Date(Date.now() + fixture.trialEndsDaysOffset * 86400 * 1000).toISOString()
    : new Date(Date.now() + 30 * 86400 * 1000).toISOString();

  await client.query(
    `INSERT INTO core.tenant_subscription
       (company_id, plan_code, status, trial_started_at, trial_ends_at,
        suspended_at, suspension_reason)
     VALUES ($1, $2, $3, NOW(), $4, $5, $6)
     ON CONFLICT (company_id) DO UPDATE
       SET plan_code         = EXCLUDED.plan_code,
           status            = EXCLUDED.status,
           trial_ends_at     = EXCLUDED.trial_ends_at,
           suspended_at      = EXCLUDED.suspended_at,
           suspension_reason = EXCLUDED.suspension_reason,
           updated_at        = NOW()`,
    [
      companyId,
      fixture.planCode,
      fixture.status,
      trialEnds,
      fixture.status === 'suspended' ? new Date().toISOString() : null,
      fixture.suspensionReason || null,
    ]
  );
}

async function upsertOverrides(client, companyId, fixture) {
  for (const [code, enabled] of Object.entries(fixture.overrides.features || {})) {
    await client.query(
      `INSERT INTO core.tenant_feature_override (company_id, feature_code, is_enabled, reason)
       VALUES ($1, $2, $3, 'test seed')
       ON CONFLICT (company_id, feature_code)
       DO UPDATE SET is_enabled = EXCLUDED.is_enabled, reason = EXCLUDED.reason`,
      [companyId, code, enabled]
    );
  }
  for (const [code, value] of Object.entries(fixture.overrides.limits || {})) {
    await client.query(
      `INSERT INTO core.tenant_limit_override (company_id, limit_code, limit_value, reason)
       VALUES ($1, $2, $3, 'test seed')
       ON CONFLICT (company_id, limit_code)
       DO UPDATE SET limit_value = EXCLUDED.limit_value, reason = EXCLUDED.reason`,
      [companyId, code, value]
    );
  }
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  const results = [];

  try {
    await client.query('BEGIN');

    for (const fx of FIXTURES) {
      process.stdout.write(`→ ${fx.code.padEnd(22)}`);
      const companyId = await registerTenant(client, fx);
      await upsertSubscription(client, companyId, fx);
      await upsertOverrides(client, companyId, fx);
      const email = `${fx.code.toLowerCase()}@test.local`;
      results.push({ code: fx.code, email, plan: fx.planCode, status: fx.status, companyId });
      console.log(`  company_id=${companyId}  [${fx.planCode}/${fx.status}]`);
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }

  console.log('\n' + '─'.repeat(70));
  console.log('ALL TEST TENANTS READY — password for all: ' + TEST_PASSWORD);
  console.log('─'.repeat(70));
  console.log('Login at: http://localhost:5173\n');

  const colW = 28;
  console.log(
    'Email'.padEnd(colW) +
    'Plan'.padEnd(10) +
    'Status'.padEnd(12) +
    'Modules active'
  );
  console.log('─'.repeat(70));

  const moduleHints = {
    T_RESTO_BASIC:       'backoffice only',
    T_RESTO_STANDARD:    'backoffice + pos',
    T_RESTO_PRO:         'backoffice + pos + hr + crm',
    T_BACKOFFICE_HR:     'backoffice + hr',
    T_BACKOFFICE_CRM:    'backoffice + crm',
    T_GARAGE_ONLY:       'garage + hr',
    T_GARAGE_BACKOFFICE: 'backoffice + garage',
    T_HR_ONLY:           'hr only',
    T_FULL_SUITE:        'ALL modules',
    T_EXPIRED:           'basic (subscription expired)',
    T_SUSPENDED:         'basic (suspended)',
  };

  for (const r of results) {
    console.log(
      r.email.padEnd(colW) +
      r.plan.padEnd(10) +
      r.status.padEnd(12) +
      (moduleHints[r.code] || '')
    );
  }
  console.log('─'.repeat(70));
}

main().catch((e) => {
  console.error('\nSeed failed:', e.message);
  process.exit(1);
});
