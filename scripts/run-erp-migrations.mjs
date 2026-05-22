/**
 * Apply selected SQL migrations using DATABASE_URL from api/.env
 * Usage: node scripts/run-erp-migrations.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MIGRATIONS = [
  '029_ops_sales_master_document_refs.sql',
  '030_accounts_chart_and_parameters.sql',
  '031_ops_sales_master_receipt_ledger.sql',
  '033_sales_accounts_full_flow.sql',
  '034_transaction_expense_and_do_status.sql',
  '035_accounts_voucher_tables.sql',
  '050_garage_customer_linkage.sql',
  '051_garage_estimation.sql',
];

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
    for (const name of MIGRATIONS) {
      const filePath = path.join(migrationsDir, name);
      if (!fs.existsSync(filePath)) {
        console.error('Missing file:', filePath);
        process.exit(1);
      }
      const sql = fs.readFileSync(filePath, 'utf8');
      console.log('Applying', name, '...');
      await client.query(sql);
      console.log('  OK', name);
    }
    console.log('\nAll migrations applied.');
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
