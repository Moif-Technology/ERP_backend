/**
 * Apply migration 070_counter_close_cash_in_out.sql
 * Usage: node scripts/run-070-cash-in-out-migration.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MIGRATION = '070_counter_close_cash_in_out.sql';
const migrationsDir = path.join(__dirname, '..', 'database', 'migrations');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL missing in api/.env');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    const sql = fs.readFileSync(path.join(migrationsDir, MIGRATION), 'utf8');
    console.log('Applying', MIGRATION, '...');
    await client.query(sql);
    console.log('  OK — cash_in_out + counter_close ready.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Migration failed:', e.message);
  process.exit(1);
});
