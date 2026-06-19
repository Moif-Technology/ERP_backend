/**
 * Sync biz customers / suppliers with accounts.account_head_master (party ledgers).
 *
 * Mapping: account_no === customer_code | supplier_code (one ledger per party per company).
 * Parent: body.parentAccId | customerParentAccId | supplierParentAccId, then
 *         accounts_parameter CUSTOMER_PARENT_LEDGER / SUPPLIER_PARENT_LEDGER,
 *         then auto-detect Accounts Receivable / Accounts Payable group.
 */
import * as accountHeadRepo from '../../accounts/repositories/accountHead.repository.js';
import * as accountsParamRepo from '../../accounts/repositories/accountsParameter.repository.js';

export const PARAM_CUSTOMER_PARENT = 'CUSTOMER_PARENT_LEDGER';
export const PARAM_SUPPLIER_PARENT = 'SUPPLIER_PARENT_LEDGER';

const HEAD_MAX = 50;

function sliceHead(name) {
  return String(name || 'Party').trim().slice(0, HEAD_MAX) || 'Party';
}

function parseParentId(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
}

async function resolveParentAccountId(client, companyId, branchId, explicitParentId, kind) {
  const explicit = parseParentId(explicitParentId);
  if (explicit) {
    const head = await accountHeadRepo.findAccountHead(client, companyId, explicit);
    if (head) return explicit;
  }

  const paramName = kind === 'customer' ? PARAM_CUSTOMER_PARENT : PARAM_SUPPLIER_PARENT;
  if (branchId != null) {
    const fromParam = await accountsParamRepo.getParameterAccountId(
      client, companyId, branchId, paramName,
    );
    if (fromParam) return fromParam;
  }

  const patterns = kind === 'customer'
    ? ['%receivable%', '%debtor%']
    : ['%payable%', '%creditor%'];

  for (const pat of patterns) {
    const { rows } = await client.query(
      `SELECT account_id
         FROM accounts.account_head_master
        WHERE company_id = $1
          AND account_head ILIKE $2
          AND (record_status IS NULL OR TRIM(UPPER(record_status)) = 'ACTIVE')
        ORDER BY account_id ASC
        LIMIT 1`,
      [companyId, pat],
    );
    if (rows[0]) return Number(rows[0].account_id);
  }
  return null;
}

/** Find active party ledger by party code (customer_code / supplier_code). */
export async function findPartyLedger(client, companyId, partyCode) {
  const code = String(partyCode || '').trim();
  if (!code) return null;

  const { rows } = await client.query(
    `SELECT account_id, account_no, account_head, parent_acc_id, account_type
       FROM accounts.account_head_master
      WHERE company_id = $1
        AND account_no = $2
        AND (record_status IS NULL OR TRIM(UPPER(record_status)) = 'ACTIVE')
      LIMIT 1`,
    [companyId, code],
  );
  if (!rows[0]) return null;
  return {
    accountId: Number(rows[0].account_id),
    accountNo: rows[0].account_no,
    accountHead: rows[0].account_head,
    parentAccId: rows[0].parent_acc_id != null ? Number(rows[0].parent_acc_id) : null,
    accountType: rows[0].account_type,
  };
}

/**
 * Create or update customer ledger under receivables parent.
 * @returns {{ accountId: number, parentAccId: number|null, created: boolean }}
 */
export async function syncCustomerLedger(client, opts) {
  const {
    companyId,
    branchId = null,
    customerCode,
    customerName,
    previousCode = null,
    parentAccId = null,
  } = opts;

  const code = String(customerCode || '').trim();
  if (!code) {
    const err = new Error('customerCode is required for ledger sync');
    err.status = 400;
    throw err;
  }

  const parent = await resolveParentAccountId(client, companyId, branchId, parentAccId, 'customer');
  const headLabel = sliceHead(customerName);
  const lookupCode = String(previousCode || code).trim();

  const existing = await findPartyLedger(client, companyId, lookupCode);

  if (existing) {
    await accountHeadRepo.updateAccountHead(client, companyId, existing.accountId, {
      accountNo: code,
      accountHead: headLabel,
      accountType: 'BS',
      parentAccId: parent,
      postingAllowed: true,
    });
    return { accountId: existing.accountId, parentAccId: parent, created: false };
  }

  const accountId = await accountHeadRepo.nextAccountId(client, companyId);
  await accountHeadRepo.createAccountHead(client, {
    companyId,
    accountId,
    parentAccId: parent,
    accountNo: code,
    accountHead: headLabel,
    accountType: 'BS',
    postingAllowed: true,
  });
  return { accountId, parentAccId: parent, created: true };
}

/**
 * Create or update supplier ledger under payables parent.
 */
export async function syncSupplierLedger(client, opts) {
  const {
    companyId,
    branchId = null,
    supplierCode,
    supplierName,
    previousCode = null,
    parentAccId = null,
  } = opts;

  const code = String(supplierCode || '').trim();
  if (!code) {
    const err = new Error('supplierCode is required for ledger sync');
    err.status = 400;
    throw err;
  }

  const parent = await resolveParentAccountId(client, companyId, branchId, parentAccId, 'supplier');
  const headLabel = sliceHead(supplierName);
  const lookupCode = String(previousCode || code).trim();

  const existing = await findPartyLedger(client, companyId, lookupCode);

  if (existing) {
    await accountHeadRepo.updateAccountHead(client, companyId, existing.accountId, {
      accountNo: code,
      accountHead: headLabel,
      accountType: 'BS',
      parentAccId: parent,
      postingAllowed: true,
    });
    return { accountId: existing.accountId, parentAccId: parent, created: false };
  }

  const accountId = await accountHeadRepo.nextAccountId(client, companyId);
  await accountHeadRepo.createAccountHead(client, {
    companyId,
    accountId,
    parentAccId: parent,
    accountNo: code,
    accountHead: headLabel,
    accountType: 'BS',
    postingAllowed: true,
  });
  return { accountId, parentAccId: parent, created: true };
}

/** Counter-POS credit sale: ensure ledger exists for customer_id (loads code/name from DB). */
export async function ensureCustomerLedgerForId(client, companyId, branchId, customerId) {
  const { rows } = await client.query(
    `SELECT customer_code, customer_name
       FROM biz.customer_master
      WHERE company_id = $1 AND customer_id = $2
      LIMIT 1`,
    [companyId, customerId],
  );
  const cust = rows[0];
  if (!cust) return null;

  const { accountId } = await syncCustomerLedger(client, {
    companyId,
    branchId,
    customerCode: cust.customer_code,
    customerName: cust.customer_name,
  });
  return accountId;
}
