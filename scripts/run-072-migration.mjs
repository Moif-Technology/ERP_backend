/**
 * Apply migration 072 — full roles & permissions seed.
 * Usage: npm run migrate:roles
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MIGRATION = '072_roles_permissions_full.sql';

function migrationPath(name) {
  return path.join(__dirname, '..', '..', 'database', 'migrations', name);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL missing in api/.env');
    process.exit(1);
  }

  const filePath = migrationPath(MIGRATION);
  if (!fs.existsSync(filePath)) {
    console.error('Missing file:', filePath);
    process.exit(1);
  }

  const sql = fs.readFileSync(filePath, 'utf8');
  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    console.log('Applying', MIGRATION, '...');
    await client.query(sql);
    console.log('Done. Default roles seeded for all companies.');
    console.log('');
    console.log('Roles created per company:');
    console.log('  COUNTER-POS  : Counter Admin, Counter Cashier, Counter Supervisor');
    console.log('  RESTAURANT-POS: Restaurant Admin, Waiter, Captain, Restaurant Cashier');
    console.log('  GARAGE       : Garage Admin, Technician, Service Advisor, Garage Supervisor, Parts Manager');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Migration failed:', e.message);
  if (e.code)   console.error('  code:',   e.code);
  if (e.detail) console.error('  detail:', e.detail);
  process.exit(1);
});
