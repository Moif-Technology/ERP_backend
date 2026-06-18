/**
 * Default per-tenant accounting bootstrap.
 *
 * A freshly registered company has NO chart of accounts, NO voucher types and
 * NO branch ledger defaults — the original rows were one-time backfills in
 * migrations 030/035 (looped over companies that existed THEN). New companies
 * got nothing, so the backoffice Accounts module + ledger posting on cash/card
 * backoffice sales would break. This module seeds the same known-good template
 * that company_id=1 carries, remapped onto the new company. Idempotent: every
 * insert is guarded with ON CONFLICT DO NOTHING on the natural business key.
 *
 * Called from registration.service.js (per new company) and exposed via
 * scripts/seed-tenant-accounts.mjs (backfill existing companies).
 */

// Chart of accounts. account_id is the stable business key (UNIQUE per company).
// [account_id, parent_acc_id, account_no, account_head, account_type, posting_allowed]
const DEFAULT_ACCOUNT_HEADS = [
  [101, null, '03-02-001', 'CASH IN HAND (CASH SALES)', null, 1],
  [102, null, '03-02-002', 'CASH IN HAND (CREDIT CARD SALES)', null, 1],
  [1001, null, '1-001', 'Cash In Hand', 'ASSET', 1],
  [1002, null, '1-002', 'Bank Account', 'ASSET', 1],
  [1003, null, '1-003', 'Accounts Receivable', 'ASSET', 1],
  [2001, null, '2-001', 'Accounts Payable', 'LIABILITY', 1],
  [4001, null, '4-001', 'Sales Revenue', 'INCOME', 1],
  [5001, null, '5-001', 'Purchases', 'EXPENSE', 1],
  [5002, null, '5-002', 'Salary Expense', 'EXPENSE', 1],
  [5003, null, '5-003', 'Rent Expense', 'EXPENSE', 1],
];

// [voucher_type_id, code, name, prefix]
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

// Branch-wise accounting parameters.
// [parameter_name, account_id, numeric_value, string_value]
const DEFAULT_PARAMETERS = [
  ['DEFAULT_CASH_LEDGER', 1001, null, 'Cash In Hand'],
  ['DEFAULT_CARD_LEDGER', 1002, null, 'Bank Account'],
  ['BOSalesCRLedgerCash', null, null, 'SALES CASH'],
  ['BOSalesCRLedgerCredit', null, null, 'SALES CREDIT'],
  ['BOSalesCRLedgerCreditCard', null, null, 'SALES CREDITCARD'],
  ['SalesEntryVoucherName', null, 1, 'Sales Voucher'],
  ['ReceiptVoucherNameCustomer', null, 9, 'Receipt Voucher'],
];

const SEED_STATION_ID = 1;

/**
 * Seed the default chart of accounts, voucher types and branch ledger defaults
 * for one company. Run inside the registration transaction (pass the same
 * `client`). Safe to re-run — existing rows are left untouched.
 */
export async function seedDefaultTenantAccounts(client, { companyId, branchId, actor = 'registration' }) {
  // 1. Chart of accounts (parents before children — flat here, all parent NULL).
  for (const [accountId, parentAccId, accountNo, accountHead, accountType, postingAllowed] of DEFAULT_ACCOUNT_HEADS) {
    await client.query(
      `INSERT INTO accounts.account_head_master
         (company_id, account_id, parent_acc_id, account_no, account_head, alias,
          account_type, posting_allowed, nature_of_trns_id, vat_group_id, record_status,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, 0, 0, 'ACTIVE', NOW(), NOW())
       ON CONFLICT (company_id, account_id) DO NOTHING`,
      [companyId, accountId, parentAccId, accountNo, accountHead, accountType, postingAllowed]
    );
  }

  // 2. Voucher types.
  for (const [voucherTypeId, code, name, prefix] of DEFAULT_VOUCHER_TYPES) {
    await client.query(
      `INSERT INTO accounts.voucher_type_master
         (company_id, voucher_type_id, voucher_type_code, voucher_name, voucher_name_alias,
          voucher_prefix, numbering_method, record_status, created_at, created_by, modified_at, modified_by)
       VALUES ($1, $2, $3, $4, $4, $5, 'AUTO', 'ACTIVE', NOW(), $6, NOW(), $6)
       ON CONFLICT (company_id, voucher_type_id) DO NOTHING`,
      [companyId, voucherTypeId, code, name, prefix, actor]
    );
  }

  // 3. Branch ledger defaults / parameters.
  for (const [parameterName, accountId, numericValue, stringValue] of DEFAULT_PARAMETERS) {
    await client.query(
      `INSERT INTO accounts.accounts_parameter
         (company_id, branch_id, station_id, parameter_name, account_id, numeric_value, string_value,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (company_id, branch_id, parameter_name) DO NOTHING`,
      [companyId, branchId, SEED_STATION_ID, parameterName, accountId, numericValue, stringValue]
    );
  }
}
