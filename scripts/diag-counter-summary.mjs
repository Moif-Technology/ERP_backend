import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const cols = await pool.query(`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'accounts' AND table_name = 'cash_transaction_master'
  ORDER BY ordinal_position
`);
console.log('columns:', cols.rows);

try {
  const q = `
    SELECT
      COALESCE(SUM(amount) FILTER (
        WHERE UPPER(TRIM(COALESCE(payment_mode, ''))) = 'CASH'
      ), 0) AS receipt_cash,
      COALESCE(SUM(amount) FILTER (
        WHERE UPPER(TRIM(COALESCE(payment_mode, ''))) IN ('CARD', 'CREDITCARD')
      ), 0) AS receipt_card,
      COUNT(*)::INT AS receipt_count
    FROM accounts.cash_transaction_master
    WHERE company_id = $1
      AND branch_id  = $2
      AND counter_no = $3
      AND created_by::text = TRIM($4::text)
      AND UPPER(COALESCE(status, 'ACTIVE')) = 'ACTIVE'
      AND UPPER(COALESCE(transaction_type, '')) IN (
        'CUSTOMER RECEIPT', 'CUSTOMER_RECEIPT', 'RECEIPT'
      )
      AND COALESCE(NULLIF(TRIM(counter_close_status), ''), 'PENDING') = 'PENDING'`;
  const r = await pool.query(q, [1, 1, 1, '1']);
  console.log('query ok:', r.rows[0]);
} catch (e) {
  console.error('query failed:', e.message, 'code:', e.code, 'position:', e.position);
}

await pool.end();
