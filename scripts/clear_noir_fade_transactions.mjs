/**
 * Clear all POS/transaction data for Noir Fade Saloon (company_id=7).
 * Keeps masters: products, groups, staff, parameters, customers, chart of accounts.
 *
 * Usage:
 *   node scripts/clear_noir_fade_transactions.mjs           # dry run (counts only)
 *   node scripts/clear_noir_fade_transactions.mjs --execute # delete data
 */
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const COMPANY_ID = 7;
const EXECUTE = process.argv.includes('--execute');

// Child tables before parents; scoped by company_id where available.
const DELETE_STEPS = [
  { table: 'ops.sales_payment_split', where: 'company_id = $1' },
  { table: 'ops.sales_child', where: 'company_id = $1' },
  { table: 'ops.sales_master', where: 'company_id = $1' },
  { table: 'ops.job_child', where: 'company_id = $1' },
  { table: 'ops.job_master', where: 'company_id = $1' },
  { table: 'ops.counter_close', where: 'company_id = $1' },
  { table: 'ops.cash_in_out', where: 'company_id = $1' },
  { table: 'ops.daily_counter_transaction', where: 'company_id = $1' },
  {
    table: 'ops.appointment_service',
    where: `appointment_id IN (SELECT appointment_id FROM ops.appointment_master WHERE company_id = $1)`,
  },
  { table: 'ops.appointment_master', where: 'company_id = $1' },
  { table: 'accounts.transaction_expense_detail', where: 'company_id = $1' },
  { table: 'accounts.voucher_detail', where: 'company_id = $1' },
  { table: 'accounts.voucher_master', where: 'company_id = $1' },
  { table: 'accounts.cash_transaction_child', where: 'company_id = $1' },
  { table: 'accounts.cash_transaction_master', where: 'company_id = $1' },
];

async function main() {
  const client = new pg.Client(
    process.env.DATABASE_URL || 'postgresql://postgres:admin@localhost:5432/moifone_uae',
  );
  await client.connect();

  try {
    const co = await client.query(
      `SELECT company_id, company_code, company_name
         FROM core.company_master
        WHERE company_id = $1`,
      [COMPANY_ID],
    );
    if (!co.rows.length) {
      throw new Error(`Company ${COMPANY_ID} not found`);
    }
    console.log('Target:', co.rows[0]);
    console.log(`Mode: ${EXECUTE ? 'EXECUTE (deleting)' : 'DRY RUN (pass --execute to delete)'}\n`);

    await client.query('BEGIN');

    for (const step of DELETE_STEPS) {
      const countSql = `SELECT COUNT(*)::int AS n FROM ${step.table} WHERE ${step.where}`;
      const countRes = await client.query(countSql, [COMPANY_ID]);
      const n = countRes.rows[0]?.n ?? 0;
      console.log(`${step.table}: ${n} row(s)`);

      if (EXECUTE && n > 0) {
        const delSql = `DELETE FROM ${step.table} WHERE ${step.where}`;
        const delRes = await client.query(delSql, [COMPANY_ID]);
        console.log(`  -> deleted ${delRes.rowCount}`);
      }
    }

    if (EXECUTE) {
      await client.query('COMMIT');
      console.log('\nDone — all Noir Fade transactions cleared.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run complete. Re-run with --execute to apply.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
