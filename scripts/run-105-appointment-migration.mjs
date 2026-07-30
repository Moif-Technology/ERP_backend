/**
 * Apply migration 105 — Salon POS appointment booking tables.
 * Usage: npm run migrate:appointments
 *
 * Creates:
 * - ops.appointment_master (booked appointments)
 * - ops.appointment_service (services in each appointment)
 * - Indices for fast queries
 * - default_duration_minutes column on core.product_master
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MIGRATION = '105_appointments.sql';

function migrationPath(name) {
  return path.join(__dirname, '..', 'database', 'migrations', name);
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
    console.log('✓ Appointment tables created');
    console.log('  - ops.appointment_master');
    console.log('  - ops.appointment_service');
    console.log('  - Indices for date/stylist/customer queries');
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
