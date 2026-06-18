/**
 * Apply migration 072_counter_close_credit_receipts.sql (counter POS settlement columns).
 * Usage: node scripts/run-072-counter-close-credit-receipts.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MIGRATION = '072_counter_close_credit_receipts.sql';
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
    const filePath = path.join(migrationsDir, MIGRATION);
    const sql = fs.readFileSync(filePath, 'utf8');
    console.log('Applying', MIGRATION, '...');
    await client.query(sql);

    const { rowCount } = await client.query(`
      UPDATE ops.counter_close cc
      SET
        credit_receipt_cash  = rc.receipt_cash,
        credit_receipt_card  = rc.receipt_card,
        credit_receipt_count = rc.receipt_count
      FROM (
        SELECT
          TRIM(ctm.counter_close_status)::bigint AS close_id,
          ctm.company_id,
          COALESCE(SUM(ctm.amount) FILTER (
            WHERE UPPER(TRIM(COALESCE(ctm.payment_mode, ''))) = 'CASH'
          ), 0) AS receipt_cash,
          COALESCE(SUM(ctm.amount) FILTER (
            WHERE UPPER(TRIM(COALESCE(ctm.payment_mode, ''))) IN ('CARD', 'CREDITCARD')
          ), 0) AS receipt_card,
          COUNT(*)::INT AS receipt_count
        FROM accounts.cash_transaction_master ctm
        WHERE TRIM(COALESCE(ctm.counter_close_status, '')) ~ '^[0-9]+$'
          AND UPPER(COALESCE(ctm.status, 'ACTIVE')) = 'ACTIVE'
          AND UPPER(COALESCE(ctm.transaction_type, '')) IN (
            'CUSTOMER RECEIPT', 'CUSTOMER_RECEIPT', 'RECEIPT'
          )
        GROUP BY 1, 2
      ) rc
      WHERE cc.id = rc.close_id
        AND cc.company_id = rc.company_id
        AND (cc.credit_receipt_count = 0 OR cc.credit_receipt_cash = 0)
        AND rc.receipt_count > 0
    `);
    console.log('  OK —', MIGRATION, 'applied. Backfilled', rowCount, 'close(s).');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Migration failed:', e.message);
  process.exit(1);
});
