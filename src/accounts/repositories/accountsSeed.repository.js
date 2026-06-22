/**
 * Standard chart of accounts — legacy MOIFONE / Tally-style template (19 groups + posting leaves).
 *
 * Stored per company (DB FK requires parent/child share company_id).
 * Template is identical for every company; users add sub-ledgers under groups via + New.
 * Branch cash/card/sales mapping: accounts.accounts_parameter per branch.
 */

// [account_id, parent_acc_id, account_no, account_head, account_type, group_type, level_no, display_order, balance_type, posting_allowed]
export const STANDARD_CHART_ACCOUNTS = [
  [1, null, '01', 'BRANCHES/DIVISIONS', 'BS', 'Liabilities', 1, 13, 'CR', 0],
  [2, null, '02', 'CAPITAL ACCOUNT', 'BS', 'Capital', 1, 1, 'DR', 0],
  [3, null, '03', 'CURRENT ASSETS', 'BS', 'Assets', 1, 2, 'DR', 0],
  [4, null, '04', 'CURRENT LIABILTIES', 'BS', 'Liabilities', 1, 3, 'CR', 0],
  [5, null, '05', 'DIRECT EXPENSES', 'PL', 'Expenses', 1, 6, 'DR', 0],
  [6, null, '06', 'DIRECT INCOMES', 'PL', 'Income', 1, 7, 'CR', 0],
  [7, null, '07', 'FIXED ASSETS', 'BS', 'Assets', 1, 8, 'DR', 0],
  [8, null, '08', 'INDIRECT EXPENSES', 'PL', 'Expenses', 1, 9, 'DR', 0],
  [9, null, '09', 'INDIRECT INCOMES', 'PL', 'Income', 1, 10, 'CR', 0],
  [10, null, '10', 'INVESTMENTS', 'PL', 'Assets', 1, 11, 'DR', 0],
  [11, null, '11', 'LOANS', 'PL', 'Liabilities', 1, 12, 'CR', 0],
  [12, null, '12', 'PURCHASE ACCOUNTS', 'BS', 'Expenses', 1, 4, 'DR', 0],
  [13, null, '13', 'SALES ACCOUNTS', 'BS', 'Income', 1, 5, 'CR', 0],
  [14, 3, '03-01', 'BANK ACCOUNTS', 'BS', '', 2, 5, 'DR', 0],
  [15, 3, '03-02', 'CASH-IN-HAND', 'BS', '', 2, 4, 'DR', 0],
  [16, 3, '03-03', 'STOCK-IN-HAND', 'BS', '', 2, 1, 'DR', 0],
  [17, 3, '03-04', 'SUNDRY DEBTORS', 'BS', '', 2, 2, 'DR', 0],
  [18, 4, '04-01', 'SUNDRY CREDITORS', 'BS', '', 2, 3, 'CR', 0],
  [19, 4, '04-02', 'DUTIES & TAXES', 'BS', '', 2, 14, 'CR', 0],
  [20, 15, '03-02-001', 'CASH IN HAND', 'BS', '', 3, 1, 'DR', 1],
  [21, 14, '03-01-001', 'BANK ACCOUNT', 'BS', '', 3, 1, 'DR', 1],
  [22, 13, '13-001', 'SALES ACCOUNT', 'PL', 'Income', 2, 1, 'CR', 1],
];

export const CHART_ACCOUNT_IDS = {
  CASH_GROUP: 15,
  BANK_GROUP: 14,
  STOCK_GROUP: 16,
  DEBTORS_GROUP: 17,
  CREDITORS_GROUP: 18,
  SALES_GROUP: 13,
  PURCHASE_GROUP: 12,
  TAX_GROUP: 19,
  DEFAULT_CASH: 20,
  DEFAULT_BANK: 21,
  DEFAULT_SALES: 22,
};

/** Legacy VATNatureTable — 10 standard nature-of-transaction rows per company. */
export const STANDARD_VAT_NATURES = [
  [1, 'Domestic Taxable Purchase', 'Purchase'],
  [2, 'Domestic NonTaxable Purchase', 'Purchase'],
  [3, 'Domestic Taxable Sale', 'Sales'],
  [4, 'Domestic NonTaxable Sale', 'Sales'],
  [5, 'Input Vat', 'VatIN'],
  [6, 'OutPut Vat', 'VatOUT'],
  [7, 'Discount Vat IN', 'VatINDiscount'],
  [8, 'Discount Vat OUT', 'VatOUTDiscount'],
  [9, 'Input Vat Expenses', 'VatIN'],
  [10, 'OutPut Vat Income', 'VatOUT'],
];

const DEFAULT_VOUCHER_TYPES = [
  [1, 'SV', 'Sales Voucher', 'SV-'],
  [2, 'DV', 'Debit Note', 'DN-'],
  [3, 'JV', 'Journal Voucher', 'JV-'],
  [4, 'PV', 'Payment Voucher', 'PV-'],
  [5, 'CV', 'Contra Voucher', 'CV-'],
  [6, 'PUR', 'Purchase Voucher', 'PUR-'],
  [7, 'EXP', 'Expense Voucher', 'EXP-'],
  [8, 'INC', 'Income Voucher', 'INC-'],
  [9, 'RV', 'Receipt Voucher', 'RV-'],
  [10, 'CN', 'Credit Note', 'CN-'],
];

const DEFAULT_PARAMETERS = [
  ['DEFAULT_CASH_LEDGER', CHART_ACCOUNT_IDS.DEFAULT_CASH, null, 'CASH IN HAND'],
  ['DEFAULT_CARD_LEDGER', CHART_ACCOUNT_IDS.DEFAULT_BANK, null, 'BANK ACCOUNT'],
  ['CODRCashReceiptLedger', CHART_ACCOUNT_IDS.DEFAULT_CASH, null, 'CASH IN HAND'],
  ['CODRCreditCardReceiptLedger', CHART_ACCOUNT_IDS.DEFAULT_BANK, null, 'BANK ACCOUNT'],
  ['CUSTOMER_PARENT_LEDGER', CHART_ACCOUNT_IDS.DEBTORS_GROUP, null, 'SUNDRY DEBTORS'],
  ['SUPPLIER_PARENT_LEDGER', CHART_ACCOUNT_IDS.CREDITORS_GROUP, null, 'SUNDRY CREDITORS'],
  ['BOSalesCRLedgerCash', CHART_ACCOUNT_IDS.DEFAULT_SALES, null, 'SALES CASH'],
  ['BOSalesCRLedgerCredit', CHART_ACCOUNT_IDS.DEFAULT_SALES, null, 'SALES CREDIT'],
  ['BOSalesCRLedgerCreditCard', CHART_ACCOUNT_IDS.DEFAULT_SALES, null, 'SALES CREDITCARD'],
  ['COSalesCRLedgerCredit', CHART_ACCOUNT_IDS.DEFAULT_SALES, null, 'SALES CREDIT'],
  ['SalesEntryVoucherName', null, 1, 'Sales Voucher'],
  ['ReceiptVoucherNameCustomer', null, 9, 'Receipt Voucher'],
];

const SEED_STATION_ID = 10;

async function insertChartAccount(client, companyId, row, actor) {
  const [
    accountId, parentAccId, accountNo, accountHead, accountType,
    groupType, levelNo, displayOrder, balanceType, postingAllowed,
  ] = row;
  await client.query(
    `INSERT INTO accounts.account_head_master
       (company_id, account_id, parent_acc_id, account_no, account_head, alias,
        account_type, group_type, level_no, display_order, account_balance_type,
        opening_balance, account_balance, posting_allowed, station_id,
        cr_on, cr_by, mod_on, mod_by, nature_of_trns_id, vat_group_id, record_status,
        created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10,
             0, 0, $11, $12, NOW(), $13, NOW(), $13, 0, 0, 'ACTIVE', NOW(), NOW())`,
    [
      companyId,
      accountId,
      parentAccId || null,
      accountNo,
      accountHead,
      accountType,
      groupType || null,
      levelNo,
      displayOrder,
      balanceType,
      postingAllowed ? 1 : 0,
      SEED_STATION_ID,
      actor,
    ],
  );
}

async function upsertBranchParameters(client, companyId, branchId) {
  for (const [parameterName, accountId, numericValue, stringValue] of DEFAULT_PARAMETERS) {
    await client.query(
      `INSERT INTO accounts.accounts_parameter
         (company_id, branch_id, station_id, parameter_name, account_id, numeric_value, string_value,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (company_id, branch_id, parameter_name)
       DO UPDATE SET
         account_id = EXCLUDED.account_id,
         numeric_value = EXCLUDED.numeric_value,
         string_value = EXCLUDED.string_value,
         updated_at = NOW()`,
      [companyId, branchId, SEED_STATION_ID, parameterName, accountId, numericValue, stringValue],
    );
  }
}

async function seedVoucherTypes(client, companyId, actor) {
  for (const [voucherTypeId, code, name, prefix] of DEFAULT_VOUCHER_TYPES) {
    await client.query(
      `INSERT INTO accounts.voucher_type_master
         (company_id, voucher_type_id, voucher_type_code, voucher_name, voucher_name_alias,
          voucher_prefix, numbering_method, record_status, created_at, created_by, modified_at, modified_by)
       VALUES ($1, $2, $3, $4, $4, $5, 'AUTO', 'ACTIVE', NOW(), $6, NOW(), $6)
       ON CONFLICT (company_id, voucher_type_id) DO NOTHING`,
      [companyId, voucherTypeId, code, name, prefix, actor],
    );
  }
}

export async function seedVatNatures(client, companyId, actor = 'seed') {
  for (const [vatNatureId, vatNatureName, vatNatureType] of STANDARD_VAT_NATURES) {
    await client.query(
      `INSERT INTO accounts.vat_nature_master (
         company_id, vat_nature_id, vat_nature_name, vat_nature_type, record_status
       ) VALUES ($1, $2, $3, $4, 'ACTIVE')
       ON CONFLICT (company_id, vat_nature_id)
       DO UPDATE SET
         vat_nature_name = EXCLUDED.vat_nature_name,
         vat_nature_type = EXCLUDED.vat_nature_type,
         record_status = 'ACTIVE'`,
      [companyId, vatNatureId, vatNatureName, vatNatureType],
    );
  }
}

async function insertStandardChart(client, companyId, actor) {
  for (const row of STANDARD_CHART_ACCOUNTS) {
    await insertChartAccount(client, companyId, row, actor);
  }
  await seedVoucherTypes(client, companyId, actor);
  await seedVatNatures(client, companyId, actor);
}

export async function replaceStandardChart(client, { companyId, branchId, actor = 'chart-replace' }) {
  await client.query(`DELETE FROM accounts.voucher_detail WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM accounts.voucher_master WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM accounts.accounts_parameter WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM accounts.account_head_master WHERE company_id = $1`, [companyId]);

  await insertStandardChart(client, companyId, actor);

  const { rows: branches } = await client.query(
    `SELECT branch_id FROM core.branch_master WHERE company_id = $1 ORDER BY branch_id`,
    [companyId],
  );
  const targets = branches.length ? branches : [{ branch_id: branchId }];
  for (const { branch_id } of targets) {
    await upsertBranchParameters(client, companyId, branch_id);
  }
}

export async function seedDefaultTenantAccounts(client, { companyId, branchId, actor = 'registration' }) {
  for (const row of STANDARD_CHART_ACCOUNTS) {
    const [
      accountId, parentAccId, accountNo, accountHead, accountType,
      groupType, levelNo, displayOrder, balanceType, postingAllowed,
    ] = row;
    await client.query(
      `INSERT INTO accounts.account_head_master
         (company_id, account_id, parent_acc_id, account_no, account_head, alias,
          account_type, group_type, level_no, display_order, account_balance_type,
          opening_balance, account_balance, posting_allowed, station_id,
          cr_on, cr_by, mod_on, mod_by, nature_of_trns_id, vat_group_id, record_status,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10,
               0, 0, $11, $12, NOW(), $13, NOW(), $13, 0, 0, 'ACTIVE', NOW(), NOW())
       ON CONFLICT (company_id, account_id) DO NOTHING`,
      [
        companyId,
        accountId,
        parentAccId || null,
        accountNo,
        accountHead,
        accountType,
        groupType || null,
        levelNo,
        displayOrder,
        balanceType,
        postingAllowed ? 1 : 0,
        SEED_STATION_ID,
        actor,
      ],
    );
  }

  await seedVoucherTypes(client, companyId, actor);
  await seedVatNatures(client, companyId, actor);
  await upsertBranchParameters(client, companyId, branchId);
}

export const DEFAULT_ACCOUNT_HEADS = STANDARD_CHART_ACCOUNTS;
