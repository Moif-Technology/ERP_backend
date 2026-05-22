/**
 * Smoke check: accounts schema + branch_defaults query (requires DATABASE_URL in api/.env).
 * Run: npm run test:accounts-schema
 */
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set (api/.env)');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  try {
    const { rows: t } = await pool.query(
      `SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_schema = 'accounts'
         AND table_name IN ('account_head_master','accounts_parameter')
       ORDER BY table_name`,
    );
    console.log('accounts tables:', t);
    if (t.length < 2) {
      console.error('FAIL: expected accounts.account_head_master and accounts.accounts_parameter');
      process.exit(1);
    }
    const { rows: c } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM accounts.account_head_master`,
    );
    console.log('account_head_master rows:', c[0]?.n);
    const { rows: p } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM accounts.accounts_parameter`,
    );
    console.log('accounts_parameter rows:', p[0]?.n);
    console.log('OK');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
