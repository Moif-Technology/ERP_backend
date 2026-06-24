/**
 * Apply migration 087 — transaction_expense_detail CrBy/ModBy as VARCHAR.
 * Usage: npm run migrate:transaction-expense-crby
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MIGRATION = '087_transaction_expense_crby_varchar.sql';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL missing in api/.env');
    process.exit(1);
  }

  const filePath = path.join(__dirname, '..', 'database', 'migrations', MIGRATION);
  const sql = fs.readFileSync(filePath, 'utf8');
  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    console.log('Applying', MIGRATION, '...');
    await client.query(sql);
    console.log('Done.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Migration failed:', e.message);
  process.exit(1);
});
