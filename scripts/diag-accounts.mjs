import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
    || 'postgresql://moif:404cd0a6509235427ffb6678d940b6dd9ce638e8ac84db53@localhost:5433/moifone_uae',
});

async function q(label, sql, params = []) {
  const r = await pool.query(sql, params);
  console.log(`\n=== ${label} (${r.rows.length} rows) ===`);
  console.log(JSON.stringify(r.rows, null, 2));
}

await q('companies', `SELECT table_schema, table_name FROM information_schema.tables WHERE table_name ILIKE '%company%' OR table_name ILIKE '%branch%' ORDER BY 1,2 LIMIT 40`);
await q(
  'accounts_parameter',
  `SELECT company_id, branch_id, parameter_name, account_id, numeric_value
   FROM accounts.accounts_parameter
   WHERE parameter_name IN (
     'DEFAULT_CASH_LEDGER','DEFAULT_CARD_LEDGER','CODRCashReceiptLedger',
     'CODRCreditCardReceiptLedger','CUSTOMER_PARENT_LEDGER','ReceiptVoucherNameCustomer'
   )
   ORDER BY company_id, branch_id, parameter_name`,
);
await q(
  'chart cash/bank/debtors',
  `SELECT company_id, account_id, account_no, account_head, parent_acc_id, posting_allowed
   FROM accounts.account_head_master
   WHERE account_no IN ('03-02-001','03-01-001','03-04','03-02','03-01')
   ORDER BY company_id, account_no`,
);
await q(
  'customer party ledgers',
  `SELECT a.company_id, a.account_id, a.account_no, a.account_head, a.parent_acc_id, a.account_type
   FROM accounts.account_head_master a
   WHERE a.parent_acc_id = 17 OR a.account_no LIKE 'CUST%'
   ORDER BY a.company_id, a.account_no LIMIT 30`,
);
await q(
  'customers without ledger',
  `SELECT c.company_id, c.customer_id, c.customer_code, c.customer_name
   FROM biz.customer_master c
   LEFT JOIN accounts.account_head_master ah
     ON ah.company_id = c.company_id AND ah.account_no = c.customer_code
    AND (ah.record_status IS NULL OR TRIM(UPPER(ah.record_status)) = 'ACTIVE')
   WHERE ah.account_id IS NULL AND COALESCE(c.status, 'ACTIVE') = 'ACTIVE'
   LIMIT 20`,
);
await q(
  'recent vouchers',
  `SELECT vm.company_id, vm.branch_id, vm.voucher_master_id, vm.voucher_prefix,
          vm.auto_voucher_no, vm.post_status, vm.voucher_date, vm.voucher_type_id
   FROM accounts.voucher_master vm
   WHERE vm.record_status = 'ACTIVE'
   ORDER BY vm.voucher_master_id DESC LIMIT 15`,
);
await q(
  'branch 3 all params',
  `SELECT parameter_name, account_id, numeric_value FROM accounts.accounts_parameter
   WHERE company_id = 1 AND branch_id = 3 ORDER BY parameter_name`,
);
await q(
  'voucher 3 lines',
  `SELECT vd.account_id, ah.account_no, ah.account_head, vd.debit_amount, vd.credit_amount
   FROM accounts.voucher_detail vd
   LEFT JOIN accounts.account_head_master ah
     ON ah.company_id = vd.company_id AND ah.account_id = vd.account_id
   WHERE vd.company_id = 1 AND vd.voucher_master_id = 3`,
);
await q(
  'sales vouchers lines',
  `SELECT vm.voucher_master_id, vm.post_status, ah.account_no, ah.account_head, vd.debit_amount, vd.credit_amount
   FROM accounts.voucher_detail vd
   JOIN accounts.voucher_master vm ON vm.company_id=vd.company_id AND vm.voucher_master_id=vd.voucher_master_id
   LEFT JOIN accounts.account_head_master ah ON ah.company_id=vd.company_id AND ah.account_id=vd.account_id
   WHERE vd.company_id=1 AND vm.voucher_type_id=1
   ORDER BY vm.voucher_master_id, vd.voucher_detail_id`,
);

await q(
  'receivable aging (debtors only)',
  `SELECT ah.account_no, ah.account_head,
          SUM(vd.debit_amount) AS dr, SUM(vd.credit_amount) AS cr,
          SUM(vd.debit_amount) - SUM(vd.credit_amount) AS net
   FROM accounts.voucher_detail vd
   JOIN accounts.voucher_master vm
     ON vm.company_id = vd.company_id AND vm.branch_id = vd.branch_id
    AND vm.voucher_master_id = vd.voucher_master_id
   JOIN accounts.account_head_master ah
     ON ah.company_id = vd.company_id AND ah.account_id = vd.account_id
   WHERE vd.record_status = 'ACTIVE' AND vm.record_status = 'ACTIVE'
     AND ah.parent_acc_id = (
       SELECT account_id FROM accounts.account_head_master
       WHERE company_id = vd.company_id AND account_no = '03-04' LIMIT 1
     )
   GROUP BY ah.account_id, ah.account_no, ah.account_head
   HAVING SUM(vd.debit_amount) - SUM(vd.credit_amount) > 0.01
   ORDER BY net DESC LIMIT 20`,
);

await q(
  'all vouchers company 1',
  `SELECT vm.voucher_master_id, vm.voucher_type_id, vt.voucher_type_code, vm.voucher_prefix,
          vm.auto_voucher_no, vm.post_status, vm.creation_mode, vm.branch_id
   FROM accounts.voucher_master vm
   LEFT JOIN accounts.voucher_type_master vt
     ON vt.company_id = vm.company_id AND vt.voucher_type_id = vm.voucher_type_id
   WHERE vm.company_id = 1 ORDER BY vm.voucher_master_id`,
);
await q('cash settlements', `SELECT transaction_id, branch_id, amount, payment_mode, voucher_master_id FROM accounts.cash_transaction_master WHERE company_id = 1`);

await pool.end();
