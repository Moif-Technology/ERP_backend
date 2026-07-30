/**
 * Seed one HR-only tenant.
 *
 * Software type 4 (HR) already grants exactly the right features — the 9 hr.*
 * plus the core.* masters — so this script does NOT invent an entitlement
 * scheme. It only creates the rows a tenant cannot log in without: company,
 * branch, role, an admin in core.staff_master, an active subscription, and the
 * role_permission grants for the HR + core pages.
 *
 * Usage:
 *   node scripts/seed-hr-tenant.mjs                    # create or update
 *   node scripts/seed-hr-tenant.mjs --dry              # show plan, change nothing
 *   node scripts/seed-hr-tenant.mjs --no-scope         # skip the feature overrides
 *
 * WHY THE OVERRIDES ARE NEEDED — do not "simplify" this away:
 * software_type_feature does NOT deny anything. applySoftwareTypeScope() treats
 * ANY row for the software type as "allowed" (granted or not); is_granted=TRUE
 * only force-enables regardless of plan. Migration 100 deliberately inserts
 * every pack for every type so the layer can only ADD access, never subtract —
 * an earlier version that scoped the allowed set stripped modules from paying
 * tenants. So with plan 'custom' (195/195 features enabled) an HR company still
 * resolves all 152 rows of software type 4 → the whole ERP appears in the UI.
 * The sanctioned per-tenant restriction is core.tenant_feature_override, applied
 * after the scope in resolveEntitlementsForStaff().
 *
 * Idempotent: safe to re-run. Prints the login at the end.
 *
 * NOTE ON THE DATABASE: api/.env points at port 5433. A different Postgres on
 * 5432 also has a database called moifone_uae (used by attendance-api). This
 * script writes wherever DATABASE_URL says — check the port before believing a
 * result.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}

const HR_SOFTWARE_TYPE_ID = 4;

const COMPANY_CODE = arg('--code', 'TRANSWAVE');
const COMPANY_NAME = arg('--name', 'Transwave');
const EMAIL        = arg('--email', 'hrtranswave@gmail.com');
// Login accepts either login_name or email (staff.repository.js:_loginSql), so
// the email doubles as the username and there is nothing extra to remember.
const LOGIN_NAME   = arg('--login', EMAIL);
const PASSWORD     = arg('--password', 'hrTWAdmin1234');
// core.plan_master codes are lowercase: basic | standard | pro | custom.
// 'custom' is what the long-lived internal tenant (company 1) uses.
const PLAN_CODE    = arg('--plan', 'custom');

const NO_SCOPE = process.argv.includes('--no-scope');
const DRY = process.argv.includes('--dry');

// Packs this tenant keeps. Everything else is switched off per-tenant.
const KEEP_PACKS = ['core', 'hr'];

// Roles this tenant starts with. software_type 'ERP' keeps them out of the POS
// login paths — an HR client has no till.
const ROLES = [
  [1, 'HR Admin',   'ERP'],
  [2, 'HR Officer', 'ERP'],
];

async function nextCompanyId(client) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(company_id), 0) + 1 AS n FROM core.company_master`,
  );
  return Number(rows[0].n);
}

async function findExisting(client) {
  const { rows } = await client.query(
    `SELECT company_id FROM core.company_master WHERE company_code = $1`,
    [COMPANY_CODE],
  );
  return rows[0] ? Number(rows[0].company_id) : null;
}

async function seed(client) {
  const now = new Date().toISOString();

  let companyId = await findExisting(client);
  const isNew = companyId == null;
  if (isNew) companyId = await nextCompanyId(client);

  console.log(`${isNew ? 'Creating' : 'Updating'} company ${companyId} (${COMPANY_CODE})`);

  // 1. Company, pinned to the HR software type.
  await client.query(
    `INSERT INTO core.company_master (
       company_id, company_code, company_name, status,
       contact_person, phone, email, software_type_id, created_at, updated_at
     ) VALUES ($1, $2, $3, 'ACTIVE', $4, '0000000000', $5, $6, $7, $7)
     ON CONFLICT (company_id) DO UPDATE
       SET software_type_id = EXCLUDED.software_type_id,
           company_name     = EXCLUDED.company_name,
           email            = EXCLUDED.email,
           status           = 'ACTIVE',
           updated_at       = EXCLUDED.updated_at`,
    [companyId, COMPANY_CODE, COMPANY_NAME, 'HR Admin', EMAIL, HR_SOFTWARE_TYPE_ID, now],
  );

  // 2. Head office branch. hr.employee_master and hr.attendance_log are scoped
  //    by (company_id, branch_id), and shift_master carries an FK to this row.
  await client.query(
    `INSERT INTO core.branch_master (
       company_id, branch_id, branch_code, branch_name, status, created_at, updated_at
     ) VALUES ($1, 1, 'HQ', $2, 'ACTIVE', $3, $3)
     ON CONFLICT (company_id, branch_id) DO NOTHING`,
    [companyId, `${COMPANY_NAME} Main`, now],
  );

  // 3. Roles.
  for (const [roleId, roleName, swType] of ROLES) {
    await client.query(
      `INSERT INTO core.role_master (
         company_id, role_id, role_name, discount_percent_allowed,
         software_type, record_status, created_by, modified_by
       ) VALUES ($1, $2, $3, 0, $4, 'ACTIVE', 'seed', 'seed')
       ON CONFLICT (company_id, role_id) DO UPDATE
         SET role_name = EXCLUDED.role_name,
             software_type = EXCLUDED.software_type,
             record_status = 'ACTIVE'`,
      [companyId, roleId, roleName, swType],
    );
  }

  // 4. Permissions. Only the HR and core pages — granting everything would let
  //    an HR client open POS/backoffice screens their software type does not
  //    include, which reads as a broken product rather than a locked one.
  const permResult = await client.query(
    `INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
     SELECT $1, 1, permission_code, TRUE
       FROM core.permission_master
      WHERE is_active = TRUE
        AND (permission_code LIKE 'hr.%' OR permission_code LIKE 'core.%')
     ON CONFLICT (company_id, role_id, permission_code)
       DO UPDATE SET is_allowed = TRUE`,
    [companyId],
  );
  console.log(`  role 1 (HR Admin): ${permResult.rowCount} permission(s) granted`);

  // HR Officer: same HR pages, but no core administration (users, roles,
  // permissions, company profile stay with the admin).
  const officerResult = await client.query(
    `INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
     SELECT $1, 2, permission_code, TRUE
       FROM core.permission_master
      WHERE is_active = TRUE
        AND permission_code LIKE 'hr.%'
     ON CONFLICT (company_id, role_id, permission_code)
       DO UPDATE SET is_allowed = TRUE`,
    [companyId],
  );
  console.log(`  role 2 (HR Officer): ${officerResult.rowCount} permission(s) granted`);

  // 5. Admin login. email_verified is set because this account is provisioned
  //    directly — there is no verification mail to click.
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await client.query(
    `INSERT INTO core.staff_master (
       company_id, staff_id, branch_id, staff_code, staff_name, designation,
       login_name, password_hash, role_id, record_status, email, email_verified,
       sync_status, server_status, created_at, created_by, modified_at, modified_by
     ) VALUES ($1, 1, 1, 'U1', 'HR Admin', 'Administrator',
               $2, $3, 1, 'ACTIVE', $4, TRUE, 'PENDING', 'PENDING', $5, 'seed', $5, 'seed')
     ON CONFLICT (company_id, staff_id) DO UPDATE
       SET password_hash  = EXCLUDED.password_hash,
           login_name     = EXCLUDED.login_name,
           email          = EXCLUDED.email,
           email_verified = TRUE,
           role_id        = EXCLUDED.role_id,
           record_status  = 'ACTIVE'`,
    [companyId, LOGIN_NAME, passwordHash, EMAIL, now],
  );

  // 6. Subscription. Without an active row the entitlement middleware treats the
  //    tenant as lapsed and every feature check fails.
  await client.query(
    `INSERT INTO core.tenant_subscription (
       company_id, plan_code, status,
       subscription_started_at, current_period_starts_at, current_period_ends_at,
       created_at, updated_at
     ) VALUES ($1, $2, 'active', $3, $3, $3::timestamptz + INTERVAL '10 years', $3, $3)
     ON CONFLICT (company_id) DO UPDATE
       SET plan_code  = EXCLUDED.plan_code,
           status     = 'active',
           current_period_ends_at = EXCLUDED.current_period_ends_at,
           suspended_at = NULL,
           cancelled_at = NULL,
           updated_at = EXCLUDED.updated_at`,
    [companyId, PLAN_CODE, now],
  );

  // 7. Restrict this tenant to the HR + core packs.
  //    Per-tenant, so the global software_type_feature seed from migration 100
  //    stays intact for every other company (see the header note).
  let disabled = 0;
  if (!NO_SCOPE) {
    const off = await client.query(
      `INSERT INTO core.tenant_feature_override (company_id, feature_code, is_enabled, reason)
       SELECT $1, feature_code, FALSE, 'HR-only tenant: pack not licensed'
         FROM core.feature_master
        WHERE is_active = TRUE
          AND COALESCE(pack_code, '') <> ALL ($2::text[])
       ON CONFLICT (company_id, feature_code)
         DO UPDATE SET is_enabled = FALSE,
                       reason     = EXCLUDED.reason,
                       modified_at = NOW()`,
      [companyId, KEEP_PACKS],
    );
    disabled = off.rowCount;

    // And make sure nothing in the kept packs is left switched off by an
    // earlier run with different KEEP_PACKS.
    await client.query(
      `DELETE FROM core.tenant_feature_override
        WHERE company_id = $1
          AND feature_code IN (
                SELECT feature_code FROM core.feature_master
                 WHERE is_active = TRUE AND pack_code = ANY ($2::text[])
              )`,
      [companyId, KEEP_PACKS],
    );
    console.log(`  scoped to packs [${KEEP_PACKS.join(', ')}]: ${disabled} feature(s) disabled for this tenant`);
  }

  // What the tenant will actually resolve: plan ∩ software-type rows, minus the
  // overrides above. Mirrors applySoftwareTypeScope() + applyOverrides().
  const { rows: eff } = await client.query(
    `WITH scoped AS (
       SELECT pf.feature_code, pf.is_enabled
         FROM core.plan_feature pf
         JOIN core.software_type_feature stf
           ON stf.feature_code = pf.feature_code
          AND stf.software_type_id = $2
        WHERE LOWER(pf.plan_code) = LOWER($3)
       UNION
       SELECT feature_code, TRUE FROM core.software_type_feature
        WHERE software_type_id = $2 AND is_granted = TRUE
     )
     SELECT COUNT(*)::int AS c
       FROM scoped s
       LEFT JOIN core.tenant_feature_override o
         ON o.company_id = $1 AND o.feature_code = s.feature_code
      WHERE COALESCE(o.is_enabled, s.is_enabled) = TRUE`,
    [companyId, HR_SOFTWARE_TYPE_ID, PLAN_CODE],
  );

  return { companyId, isNew, effectiveFeatures: eff[0].c, disabled };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set in api/.env');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  const shown = url.replace(/:[^:@/]+@/, ':***@');

  try {
    console.log(`Database: ${shown}`);
    if (DRY) console.log('--dry: rolling back at the end, nothing is kept\n');

    await client.query('BEGIN');
    const result = await seed(client);

    if (DRY) {
      await client.query('ROLLBACK');
      console.log('\nRolled back (--dry).');
    } else {
      await client.query('COMMIT');
      console.log('\nCommitted.');
    }

    console.log('\n─────────────────────────────────────────────');
    console.log(` Company    : ${result.companyId}  ${COMPANY_CODE} — ${COMPANY_NAME}`);
    console.log(` Software   : ${HR_SOFTWARE_TYPE_ID} (HR & Payroll)`);
    console.log(` Features   : ${result.effectiveFeatures} effective (packs: ${KEEP_PACKS.join(' + ')})`);
    console.log(` Plan       : ${PLAN_CODE} (active)`);
    console.log(` Login      : ${LOGIN_NAME}`);
    console.log(` Password   : ${PASSWORD}`);
    console.log('─────────────────────────────────────────────');
    console.log('Change this password after the first login.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nFailed, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
