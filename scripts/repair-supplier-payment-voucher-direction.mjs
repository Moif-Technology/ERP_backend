import { pool } from '../src/config/db.js';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`
      WITH wrong_supplier_lines AS (
        SELECT
          vd.company_id,
          vd.branch_id,
          vd.voucher_master_id,
          vd.account_id AS supplier_account_id,
          vd.credit_amount AS amount
        FROM accounts.voucher_detail vd
        JOIN accounts.voucher_master vm
          ON vm.company_id = vd.company_id
         AND vm.branch_id = vd.branch_id
         AND vm.voucher_master_id = vd.voucher_master_id
        JOIN biz.supplier_master sm
          ON sm.company_id = vd.company_id
        JOIN accounts.account_head_master ah
          ON ah.company_id = sm.company_id
         AND ah.account_no = sm.supplier_code
         AND ah.account_id = vd.account_id
        WHERE UPPER(COALESCE(vm.creation_mode, '')) = 'BACKOFFICE'
          AND vm.voucher_posted_id IS NOT NULL
          AND COALESCE(vd.credit_amount, 0) > 0
          AND COALESCE(vd.debit_amount, 0) = 0
          AND COALESCE(vd.outstanding_balance, 0) = 0
          AND EXISTS (
            SELECT 1
            FROM accounts.cash_transaction_master ctm
            WHERE ctm.company_id = vm.company_id
              AND ctm.branch_id = vm.branch_id
              AND ctm.transaction_id = vm.voucher_posted_id
              AND ctm.supplier_id = sm.supplier_id
          )
      ),
      flipped_supplier_lines AS (
        UPDATE accounts.voucher_detail vd
        SET debit_amount = w.amount,
            credit_amount = 0,
            modified_at = NOW()
        FROM wrong_supplier_lines w
        WHERE vd.company_id = w.company_id
          AND vd.branch_id = w.branch_id
          AND vd.voucher_master_id = w.voucher_master_id
          AND vd.account_id = w.supplier_account_id
          AND vd.credit_amount = w.amount
          AND COALESCE(vd.debit_amount, 0) = 0
        RETURNING vd.company_id, vd.branch_id, vd.voucher_master_id, w.supplier_account_id, w.amount
      ),
      flipped_payment_lines AS (
        UPDATE accounts.voucher_detail vd
        SET credit_amount = vd.debit_amount,
            debit_amount = 0,
            modified_at = NOW()
        FROM flipped_supplier_lines f
        WHERE vd.company_id = f.company_id
          AND vd.branch_id = f.branch_id
          AND vd.voucher_master_id = f.voucher_master_id
          AND vd.account_id <> f.supplier_account_id
          AND COALESCE(vd.debit_amount, 0) > 0
          AND COALESCE(vd.credit_amount, 0) = 0
          AND COALESCE(vd.outstanding_balance, 0) = 0
        RETURNING vd.company_id, vd.branch_id, vd.voucher_master_id
      )
      SELECT
        (SELECT COUNT(*) FROM flipped_supplier_lines)::int AS supplier_lines,
        (SELECT COUNT(*) FROM flipped_payment_lines)::int AS payment_lines;
    `);

    await client.query('COMMIT');
    const result = rows[0] || {};
    console.log(`Repaired supplier lines: ${result.supplier_lines || 0}`);
    console.log(`Repaired payment lines: ${result.payment_lines || 0}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
