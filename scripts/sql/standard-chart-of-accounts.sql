-- =============================================================================
-- MOIFONE ERP — Standard Chart of Accounts (PostgreSQL)
-- =============================================================================
-- Legacy template: AccountHeadMaster rows 1–19 + default posting ledgers 20–22.
-- Same data as: api/src/accounts/repositories/accountsSeed.repository.js
--
-- HOW TO USE (pgAdmin / DBeaver / psql)
--   1. Connect to your MOIFONE database.
--   2. Edit v_company_id in each section you run (default = 1).
--   3. Run SECTION 1 first — inspect current chart.
--   4. Choose ONE of:
--        SECTION 2 — SAFE seed (insert missing rows only; keeps existing data)
--        SECTION 3 — FULL reset (deletes vouchers + chart + params; re-inserts)
--
-- EASIER CLI (recommended):
--   cd api
--   node scripts/seed-tenant-accounts.mjs          # safe — companies with no chart
--   node scripts/seed-tenant-accounts.mjs 1      # safe — one company
--   node scripts/replace-standard-chart.mjs 1    # full reset — one company
--
-- WARNING — SECTION 3 deletes for the chosen company:
--   • all voucher_detail + voucher_master
--   • all accounts_parameter (branch integration remapped after insert)
--   • all account_head_master (including user-created customer/supplier ledgers)
--   Does NOT delete customers/suppliers in biz.* — re-sync party ledgers from UI
--   or re-save customers if needed after reset.
-- =============================================================================


-- =============================================================================
-- SECTION 1 — INSPECT (read-only)
-- =============================================================================
-- Change company_id in the WHERE clause, then execute.

SELECT company_id, account_id, parent_acc_id, account_no, account_head,
       account_type, posting_allowed, record_status
FROM accounts.account_head_master
WHERE company_id = 1
ORDER BY account_no, account_id;

SELECT company_id, branch_id, parameter_name, account_id, numeric_value, string_value
FROM accounts.accounts_parameter
WHERE company_id = 1
ORDER BY branch_id, parameter_name;

SELECT company_id, voucher_type_id, voucher_type_code, voucher_name, voucher_prefix
FROM accounts.voucher_type_master
WHERE company_id = 1
ORDER BY voucher_type_id;


-- =============================================================================
-- SECTION 2 — SAFE SEED (insert standard chart when missing)
-- =============================================================================
-- Idempotent: ON CONFLICT DO NOTHING on chart + voucher types.
-- Branch parameters: upserted for every branch of the company.

DO $$
DECLARE
  v_company_id   bigint := 1;          -- <<< EDIT company_id
  v_actor        text   := 'sql-seed';
  v_station_id   int    := 10;
  v_branch_id    bigint;
BEGIN
  -- Standard chart (22 rows)
  INSERT INTO accounts.account_head_master (
    company_id, account_id, parent_acc_id, account_no, account_head, alias,
    account_type, group_type, level_no, display_order, account_balance_type,
    opening_balance, account_balance, posting_allowed, station_id,
    cr_on, cr_by, mod_on, mod_by, nature_of_trns_id, vat_group_id, record_status,
    created_at, updated_at
  )
  SELECT
    v_company_id,
    d.account_id,
    d.parent_acc_id,
    d.account_no,
    d.account_head,
    d.account_head,
    d.account_type,
    NULLIF(d.group_type, ''),
    d.level_no,
    d.display_order,
    d.balance_type,
    0, 0,
    d.posting_allowed,
    v_station_id,
    NOW(), v_actor, NOW(), v_actor,
    0, 0, 'ACTIVE',
    NOW(), NOW()
  FROM (
    VALUES
      -- account_id, parent_acc_id, account_no, account_head, type, group_type, level, order, bal_type, posting
      ( 1::bigint, NULL::bigint, '01',      'BRANCHES/DIVISIONS',  'BS', 'Liabilities', 1, 13, 'CR', 0),
      ( 2,         NULL,         '02',      'CAPITAL ACCOUNT',     'BS', 'Capital',     1,  1, 'DR', 0),
      ( 3,         NULL,         '03',      'CURRENT ASSETS',      'BS', 'Assets',      1,  2, 'DR', 0),
      ( 4,         NULL,         '04',      'CURRENT LIABILTIES',  'BS', 'Liabilities', 1,  3, 'CR', 0),
      ( 5,         NULL,         '05',      'DIRECT EXPENSES',     'PL', 'Expenses',    1,  6, 'DR', 0),
      ( 6,         NULL,         '06',      'DIRECT INCOMES',      'PL', 'Income',      1,  7, 'CR', 0),
      ( 7,         NULL,         '07',      'FIXED ASSETS',        'BS', 'Assets',      1,  8, 'DR', 0),
      ( 8,         NULL,         '08',      'INDIRECT EXPENSES',   'PL', 'Expenses',    1,  9, 'DR', 0),
      ( 9,         NULL,         '09',      'INDIRECT INCOMES',    'PL', 'Income',      1, 10, 'CR', 0),
      (10,         NULL,         '10',      'INVESTMENTS',         'PL', 'Assets',      1, 11, 'DR', 0),
      (11,         NULL,         '11',      'LOANS',               'PL', 'Liabilities', 1, 12, 'CR', 0),
      (12,         NULL,         '12',      'PURCHASE ACCOUNTS',   'BS', 'Expenses',    1,  4, 'DR', 0),
      (13,         NULL,         '13',      'SALES ACCOUNTS',      'BS', 'Income',      1,  5, 'CR', 0),
      (14,         3,            '03-01',   'BANK ACCOUNTS',       'BS', '',            2,  5, 'DR', 0),
      (15,         3,            '03-02',   'CASH-IN-HAND',        'BS', '',            2,  4, 'DR', 0),
      (16,         3,            '03-03',   'STOCK-IN-HAND',       'BS', '',            2,  1, 'DR', 0),
      (17,         3,            '03-04',   'SUNDRY DEBTORS',      'BS', '',            2,  2, 'DR', 0),
      (18,         4,            '04-01',   'SUNDRY CREDITORS',    'BS', '',            2,  3, 'CR', 0),
      (19,         4,            '04-02',   'DUTIES & TAXES',      'BS', '',            2, 14, 'CR', 0),
      (20,        15,            '03-02-001','CASH IN HAND',       'BS', '',            3,  1, 'DR', 1),
      (21,        14,            '03-01-001','BANK ACCOUNT',       'BS', '',            3,  1, 'DR', 1),
      (22,        13,            '13-001',  'SALES ACCOUNT',       'PL', 'Income',      2,  1, 'CR', 1)
  ) AS d(account_id, parent_acc_id, account_no, account_head, account_type, group_type,
         level_no, display_order, balance_type, posting_allowed)
  ON CONFLICT (company_id, account_id) DO NOTHING;

  -- Voucher types (10 rows)
  INSERT INTO accounts.voucher_type_master (
    company_id, voucher_type_id, voucher_type_code, voucher_name, voucher_name_alias,
    voucher_prefix, numbering_method, record_status, created_at, created_by, modified_at, modified_by
  )
  SELECT v_company_id, d.voucher_type_id, d.code, d.name, d.name, d.prefix,
         'AUTO', 'ACTIVE', NOW(), v_actor, NOW(), v_actor
  FROM (
    VALUES
      (1,  'SV',  'Sales Voucher',     'SV-'),
      (2,  'DV',  'Debit Note',        'DN-'),
      (3,  'JV',  'Journal Voucher',   'JV-'),
      (4,  'PV',  'Payment Voucher',   'PV-'),
      (5,  'CV',  'Contra Voucher',    'CV-'),
      (6,  'PUR', 'Purchase Voucher',  'PUR-'),
      (7,  'EXP', 'Expense Voucher',   'EXP-'),
      (8,  'INC', 'Income Voucher',    'INC-'),
      (9,  'RV',  'Receipt Voucher',   'RV-'),
      (10, 'CN',  'Credit Note',       'CN-')
  ) AS d(voucher_type_id, code, name, prefix)
  ON CONFLICT (company_id, voucher_type_id) DO NOTHING;

  -- Branch integration parameters (every branch)
  FOR v_branch_id IN
    SELECT branch_id FROM core.branch_master WHERE company_id = v_company_id ORDER BY branch_id
  LOOP
    INSERT INTO accounts.accounts_parameter (
      company_id, branch_id, station_id, parameter_name, account_id, numeric_value, string_value,
      created_at, updated_at
    )
    VALUES
      (v_company_id, v_branch_id, v_station_id, 'DEFAULT_CASH_LEDGER',           20, NULL, 'CASH IN HAND',       NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'DEFAULT_CARD_LEDGER',           21, NULL, 'BANK ACCOUNT',       NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'CODRCashReceiptLedger',         20, NULL, 'CASH IN HAND',       NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'CODRCreditCardReceiptLedger',   21, NULL, 'BANK ACCOUNT',       NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'CUSTOMER_PARENT_LEDGER',        17, NULL, 'SUNDRY DEBTORS',     NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'SUPPLIER_PARENT_LEDGER',        18, NULL, 'SUNDRY CREDITORS',   NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'BOSalesCRLedgerCash',           22, NULL, 'SALES CASH',         NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'BOSalesCRLedgerCredit',         22, NULL, 'SALES CREDIT',       NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'BOSalesCRLedgerCreditCard',     22, NULL, 'SALES CREDITCARD',   NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'COSalesCRLedgerCredit',         22, NULL, 'SALES CREDIT',       NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'SalesEntryVoucherName',       NULL,    1, 'Sales Voucher',      NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'ReceiptVoucherNameCustomer',  NULL,    9, 'Receipt Voucher',      NOW(), NOW())
    ON CONFLICT (company_id, branch_id, parameter_name)
    DO UPDATE SET
      account_id    = EXCLUDED.account_id,
      numeric_value = EXCLUDED.numeric_value,
      string_value  = EXCLUDED.string_value,
      updated_at    = NOW();
  END LOOP;

  RAISE NOTICE 'Safe seed completed for company_id=%', v_company_id;
END $$;


-- =============================================================================
-- SECTION 3 — FULL RESET + RE-INSERT (destructive)
-- =============================================================================
-- Use after DB restore or when chart is corrupted / wrong IDs.
-- Uncomment and run ONLY when you accept data loss for that company.

/*
DO $$
DECLARE
  v_company_id   bigint := 1;          -- <<< EDIT company_id
  v_actor        text   := 'sql-replace';
  v_station_id   int    := 10;
  v_branch_id    bigint;
BEGIN
  -- Remove accounting transactions first (child before parent)
  DELETE FROM accounts.voucher_detail      WHERE company_id = v_company_id;
  DELETE FROM accounts.voucher_master      WHERE company_id = v_company_id;
  DELETE FROM accounts.transaction_expense_detail WHERE company_id = v_company_id;

  -- Optional: uncomment if DELETE account_head_master fails on FK
  -- DELETE FROM accounts.cash_transaction_child  WHERE company_id = v_company_id;
  -- DELETE FROM accounts.cash_transaction_master WHERE company_id = v_company_id;

  DELETE FROM accounts.accounts_parameter  WHERE company_id = v_company_id;
  DELETE FROM accounts.account_head_master WHERE company_id = v_company_id;

  -- Re-insert chart (same 22 rows as SECTION 2, without ON CONFLICT)
  INSERT INTO accounts.account_head_master (
    company_id, account_id, parent_acc_id, account_no, account_head, alias,
    account_type, group_type, level_no, display_order, account_balance_type,
    opening_balance, account_balance, posting_allowed, station_id,
    cr_on, cr_by, mod_on, mod_by, nature_of_trns_id, vat_group_id, record_status,
    created_at, updated_at
  )
  SELECT
    v_company_id, d.account_id, d.parent_acc_id, d.account_no, d.account_head, d.account_head,
    d.account_type, NULLIF(d.group_type, ''), d.level_no, d.display_order, d.balance_type,
    0, 0, d.posting_allowed, v_station_id,
    NOW(), v_actor, NOW(), v_actor, 0, 0, 'ACTIVE', NOW(), NOW()
  FROM (
    VALUES
      ( 1::bigint, NULL::bigint, '01',      'BRANCHES/DIVISIONS',  'BS', 'Liabilities', 1, 13, 'CR', 0),
      ( 2,         NULL,         '02',      'CAPITAL ACCOUNT',     'BS', 'Capital',     1,  1, 'DR', 0),
      ( 3,         NULL,         '03',      'CURRENT ASSETS',      'BS', 'Assets',      1,  2, 'DR', 0),
      ( 4,         NULL,         '04',      'CURRENT LIABILTIES',  'BS', 'Liabilities', 1,  3, 'CR', 0),
      ( 5,         NULL,         '05',      'DIRECT EXPENSES',     'PL', 'Expenses',    1,  6, 'DR', 0),
      ( 6,         NULL,         '06',      'DIRECT INCOMES',      'PL', 'Income',      1,  7, 'CR', 0),
      ( 7,         NULL,         '07',      'FIXED ASSETS',        'BS', 'Assets',      1,  8, 'DR', 0),
      ( 8,         NULL,         '08',      'INDIRECT EXPENSES',   'PL', 'Expenses',    1,  9, 'DR', 0),
      ( 9,         NULL,         '09',      'INDIRECT INCOMES',    'PL', 'Income',      1, 10, 'CR', 0),
      (10,         NULL,         '10',      'INVESTMENTS',         'PL', 'Assets',      1, 11, 'DR', 0),
      (11,         NULL,         '11',      'LOANS',               'PL', 'Liabilities', 1, 12, 'CR', 0),
      (12,         NULL,         '12',      'PURCHASE ACCOUNTS',   'BS', 'Expenses',    1,  4, 'DR', 0),
      (13,         NULL,         '13',      'SALES ACCOUNTS',      'BS', 'Income',      1,  5, 'CR', 0),
      (14,         3,            '03-01',   'BANK ACCOUNTS',       'BS', '',            2,  5, 'DR', 0),
      (15,         3,            '03-02',   'CASH-IN-HAND',        'BS', '',            2,  4, 'DR', 0),
      (16,         3,            '03-03',   'STOCK-IN-HAND',       'BS', '',            2,  1, 'DR', 0),
      (17,         3,            '03-04',   'SUNDRY DEBTORS',      'BS', '',            2,  2, 'DR', 0),
      (18,         4,            '04-01',   'SUNDRY CREDITORS',    'BS', '',            2,  3, 'CR', 0),
      (19,         4,            '04-02',   'DUTIES & TAXES',      'BS', '',            2, 14, 'CR', 0),
      (20,        15,            '03-02-001','CASH IN HAND',       'BS', '',            3,  1, 'DR', 1),
      (21,        14,            '03-01-001','BANK ACCOUNT',       'BS', '',            3,  1, 'DR', 1),
      (22,        13,            '13-001',  'SALES ACCOUNT',       'PL', 'Income',      2,  1, 'CR', 1)
  ) AS d(account_id, parent_acc_id, account_no, account_head, account_type, group_type,
         level_no, display_order, balance_type, posting_allowed);

  INSERT INTO accounts.voucher_type_master (
    company_id, voucher_type_id, voucher_type_code, voucher_name, voucher_name_alias,
    voucher_prefix, numbering_method, record_status, created_at, created_by, modified_at, modified_by
  )
  SELECT v_company_id, d.voucher_type_id, d.code, d.name, d.name, d.prefix,
         'AUTO', 'ACTIVE', NOW(), v_actor, NOW(), v_actor
  FROM (
    VALUES
      (1,  'SV',  'Sales Voucher',     'SV-'),
      (2,  'DV',  'Debit Note',        'DN-'),
      (3,  'JV',  'Journal Voucher',   'JV-'),
      (4,  'PV',  'Payment Voucher',   'PV-'),
      (5,  'CV',  'Contra Voucher',    'CV-'),
      (6,  'PUR', 'Purchase Voucher',  'PUR-'),
      (7,  'EXP', 'Expense Voucher',   'EXP-'),
      (8,  'INC', 'Income Voucher',    'INC-'),
      (9,  'RV',  'Receipt Voucher',   'RV-'),
      (10, 'CN',  'Credit Note',       'CN-')
  ) AS d(voucher_type_id, code, name, prefix)
  ON CONFLICT (company_id, voucher_type_id) DO NOTHING;

  FOR v_branch_id IN
    SELECT branch_id FROM core.branch_master WHERE company_id = v_company_id ORDER BY branch_id
  LOOP
    INSERT INTO accounts.accounts_parameter (
      company_id, branch_id, station_id, parameter_name, account_id, numeric_value, string_value,
      created_at, updated_at
    )
    VALUES
      (v_company_id, v_branch_id, v_station_id, 'DEFAULT_CASH_LEDGER',           20, NULL, 'CASH IN HAND',       NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'DEFAULT_CARD_LEDGER',           21, NULL, 'BANK ACCOUNT',       NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'CODRCashReceiptLedger',         20, NULL, 'CASH IN HAND',       NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'CODRCreditCardReceiptLedger',   21, NULL, 'BANK ACCOUNT',       NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'CUSTOMER_PARENT_LEDGER',        17, NULL, 'SUNDRY DEBTORS',     NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'SUPPLIER_PARENT_LEDGER',        18, NULL, 'SUNDRY CREDITORS',   NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'BOSalesCRLedgerCash',           22, NULL, 'SALES CASH',         NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'BOSalesCRLedgerCredit',         22, NULL, 'SALES CREDIT',       NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'BOSalesCRLedgerCreditCard',     22, NULL, 'SALES CREDITCARD',   NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'COSalesCRLedgerCredit',         22, NULL, 'SALES CREDIT',       NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'SalesEntryVoucherName',       NULL,    1, 'Sales Voucher',      NOW(), NOW()),
      (v_company_id, v_branch_id, v_station_id, 'ReceiptVoucherNameCustomer',  NULL,    9, 'Receipt Voucher',      NOW(), NOW())
    ON CONFLICT (company_id, branch_id, parameter_name)
    DO UPDATE SET
      account_id    = EXCLUDED.account_id,
      numeric_value = EXCLUDED.numeric_value,
      string_value  = EXCLUDED.string_value,
      updated_at    = NOW();
  END LOOP;

  RAISE NOTICE 'Full chart replace completed for company_id=%', v_company_id;
END $$;
*/


-- =============================================================================
-- SECTION 4 — VERIFY (run after SECTION 2 or 3)
-- =============================================================================

SELECT COUNT(*) AS chart_rows
FROM accounts.account_head_master
WHERE company_id = 1;   -- expect 22 for a fresh standard chart

SELECT account_id, account_no, account_head, parent_acc_id, posting_allowed
FROM accounts.account_head_master
WHERE company_id = 1
ORDER BY account_no;

-- Key integration IDs (for reference):
--   14 = Bank group        20 = Default cash ledger (03-02-001)
--   15 = Cash group        21 = Default bank ledger (03-01-001)
--   17 = Sundry Debtors    22 = Default sales ledger (13-001)
--   18 = Sundry Creditors
-- Users add new ledgers under these groups via Chart of Accounts → + Child.
