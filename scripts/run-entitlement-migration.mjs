/**
 * Apply the SaaS entitlement migration using DATABASE_URL from api/.env.
 * Usage: npm run migrate:entitlements
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const migrationNames = [
  '044_core_entitlements.sql',
  '064_pos_plan_feature_matrix.sql',
  '065_pos_granular_ui_features.sql',
  '066_deprecate_pos_layout_preset_features.sql',
  '067_pos_unsaved_cart_settlement_feature.sql',
  '068_pos_kot_save_without_area_feature.sql',
];

function migrationPath(name) {
  return path.join(
    __dirname,
    '..',
    '..',
    'database',
    'migrations',
    name
  );
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL missing in api/.env');
    process.exit(1);
  }
  for (const name of migrationNames) {
    const filePath = migrationPath(name);
    if (!fs.existsSync(filePath)) {
      console.error('Missing file:', filePath);
      process.exit(1);
    }
  }

  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    for (const name of migrationNames) {
      const filePath = migrationPath(name);
      const sql = fs.readFileSync(filePath, 'utf8');
      console.log('Applying', name, '...');
      await client.query(sql);
      console.log('OK', name);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Migration failed:', e.message);
  if (e.code) console.error('  code:', e.code);
  if (e.detail) console.error('  detail:', e.detail);
  process.exit(1);
});
