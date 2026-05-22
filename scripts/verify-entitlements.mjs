/**
 * Smoke check for SaaS entitlement schema and resolver.
 * Usage: npm run test:entitlements
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function tableCount(pool, tableName) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM information_schema.tables
     WHERE table_schema = 'core'
       AND table_name = $1`,
    [tableName]
  );
  return rows[0]?.n ?? 0;
}

async function countRows(pool, sql) {
  const { rows } = await pool.query(sql);
  return rows[0]?.n ?? 0;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL missing in api/.env');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url });
  try {
    const requiredTables = [
      'feature_master',
      'plan_feature',
      'tenant_subscription',
      'tenant_feature_override',
      'limit_master',
      'plan_limit',
      'tenant_limit_override',
      'role_permission',
      'subscription_audit_log',
    ];

    for (const tableName of requiredTables) {
      const exists = await tableCount(pool, tableName);
      if (!exists) {
        console.error(`FAIL: missing core.${tableName}`);
        process.exit(1);
      }
    }

    const featureCount = await countRows(
      pool,
      `SELECT COUNT(*)::int AS n FROM core.feature_master`
    );
    const planFeatureCount = await countRows(
      pool,
      `SELECT COUNT(*)::int AS n FROM core.plan_feature`
    );
    const limitCount = await countRows(
      pool,
      `SELECT COUNT(*)::int AS n FROM core.limit_master`
    );
    const subscriptionCount = await countRows(
      pool,
      `SELECT COUNT(*)::int AS n FROM core.tenant_subscription`
    );

    console.log('feature_master rows:', featureCount);
    console.log('plan_feature rows:', planFeatureCount);
    console.log('limit_master rows:', limitCount);
    console.log('tenant_subscription rows:', subscriptionCount);

    if (featureCount < 50 || planFeatureCount < 1 || limitCount < 5) {
      console.error('FAIL: entitlement seed data looks incomplete');
      process.exit(1);
    }

    const { rows: staffRows } = await pool.query(
      `SELECT s.id, s.staff_id, s.staff_name, s.role_id, s.branch_id, s.company_id,
              c.company_name, c.company_address, b.branch_name,
              st.software_code AS software_type_code
       FROM core.staff_master s
       JOIN core.company_master c ON c.company_id = s.company_id
       LEFT JOIN core.branch_master b ON b.company_id = s.company_id AND b.branch_id = s.branch_id
       LEFT JOIN core.software_type_master st ON st.software_type_id = c.software_type_id
       WHERE s.record_status = 'ACTIVE'
       ORDER BY s.id ASC
       LIMIT 1`
    );

    if (!staffRows.length) {
      console.log('No active staff found; schema and seed checks passed.');
      console.log('OK');
      return;
    }

    const { resolveEntitlementsForStaff, resolvePosPrivilegesForStaff } =
      await import('../src/services/entitlement.service.js');

    const access = await resolveEntitlementsForStaff(staffRows[0], pool);
    const privileges = await resolvePosPrivilegesForStaff(staffRows[0], pool);

    console.log('resolver subscription:', access.subscription);
    console.log('resolver feature count:', Object.keys(access.features || {}).length);
    console.log('resolver limit count:', Object.keys(access.limits || {}).length);
    console.log('resolver permission count:', access.permissions?.length || 0);
    console.log('resolver POS privilege count:', privileges.length);

    if (!access.subscription || !privileges.length) {
      console.error('FAIL: entitlement resolver returned incomplete output');
      process.exit(1);
    }

    console.log('OK');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
