/**
 * Apply migration 095_van_features_permissions.sql.
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/run-095-van-permissions.mjs
 *   PROD_DATABASE_URL=postgresql://... node scripts/run-095-van-permissions.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MIGRATION = path.join(__dirname, '..', 'database', 'migrations', '095_van_features_permissions.sql');

const DATABASES = [
  { label: 'DATABASE_URL', url: process.env.DATABASE_URL },
  { label: 'PROD_DATABASE_URL', url: process.env.PROD_DATABASE_URL },
].filter((db) => db.url);

async function applyMigration(url, label) {
  console.log(`\n── ${label} ──`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    await client.query(sql);

    const { rows } = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM core.feature_master  WHERE pack_code = 'van') AS van_features,
        (SELECT COUNT(*)::int FROM core.permission_master WHERE feature_code LIKE 'van.%' AND is_active) AS van_permissions,
        (SELECT COUNT(*)::int FROM core.role_master WHERE software_type = 'VAN') AS van_roles
    `);
    console.log('  van_features:    ', rows[0].van_features);
    console.log('  van_permissions: ', rows[0].van_permissions);
    console.log('  van_roles:       ', rows[0].van_roles);
    console.log('  OK');
  } finally {
    await client.end();
  }
}

(async () => {
  if (!fs.existsSync(MIGRATION)) {
    console.error('Migration file not found:', MIGRATION);
    process.exit(1);
  }

  if (!DATABASES.length) {
    console.error('Set DATABASE_URL or PROD_DATABASE_URL before running this migration.');
    process.exit(1);
  }

  for (const db of DATABASES) {
    await applyMigration(db.url, db.label);
  }
  console.log('\nDone.');
})().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
