/**
 * Apply migration 070_counter_close.sql
 * Usage: node scripts/run-counter-close-migration.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MIGRATION = '070_counter_close.sql';
const migrationsDir = path.join(__dirname, '..', '..', 'database', 'migrations');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL missing in api/.env');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    const filePath = path.join(migrationsDir, MIGRATION);
    if (!fs.existsSync(filePath)) {
      console.error('Missing file:', filePath);
      process.exit(1);
    }
    const sql = fs.readFileSync(filePath, 'utf8');
    console.log('Applying', MIGRATION, '...');
    await client.query(sql);
    console.log('  OK —', MIGRATION, 'applied.');
    console.log('\nDone. counter_close + cash_in_out tables created, counter_close_status added to sales_master.');
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
