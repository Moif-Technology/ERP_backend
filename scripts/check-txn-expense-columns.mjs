import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(`
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_schema = 'accounts' AND table_name = 'transaction_expense_detail'
    AND column_name IN ('created_by', 'modified_by')
`);
console.log(rows);
await pool.end();
