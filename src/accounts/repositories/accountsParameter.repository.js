/**
 * accounts.accounts_parameter — branch-wise (company + branch).
 */

import {
  INTEGRATION_PARAMETER_DEFS,
  INTEGRATION_TABS,
  INTEGRATION_PARAM_BY_KEY,
  REQUIRED_INTEGRATION_KEYS,
  PARAMETER_ALIASES_ON_SAVE,
  PARAMETER_READ_FALLBACKS,
} from '../config/integrationParameters.js';
import { CHART_ACCOUNT_IDS } from './accountsSeed.repository.js';

export const PARAM_DEFAULT_CASH_LEDGER = 'DEFAULT_CASH_LEDGER';
export const PARAM_DEFAULT_CARD_LEDGER = 'DEFAULT_CARD_LEDGER';
export const PARAM_CUSTOMER_PARENT_LEDGER = 'CUSTOMER_PARENT_LEDGER';
export const PARAM_SUPPLIER_PARENT_LEDGER = 'SUPPLIER_PARENT_LEDGER';
export const PARAM_SALES_CR_LEDGER_CASH = 'BOSalesCRLedgerCash';
export const PARAM_SALES_CR_LEDGER_CREDIT = 'BOSalesCRLedgerCredit';
export const PARAM_SALES_CR_LEDGER_CARD = 'BOSalesCRLedgerCreditCard';
export const PARAM_DEFAULT_SALES_LEDGER = 'DEFAULT_SALES_LEDGER';

/** @deprecated use INTEGRATION_PARAMETER_DEFS */
export const BRANCH_INTEGRATION_PARAM_MAP = {
  defaultCashAccountId: PARAM_DEFAULT_CASH_LEDGER,
  defaultCardAccountId: PARAM_DEFAULT_CARD_LEDGER,
  customerParentAccountId: PARAM_CUSTOMER_PARENT_LEDGER,
  supplierParentAccountId: PARAM_SUPPLIER_PARENT_LEDGER,
  salesCashAccountId: PARAM_SALES_CR_LEDGER_CASH,
  salesCreditAccountId: PARAM_SALES_CR_LEDGER_CREDIT,
  salesCreditCardAccountId: PARAM_SALES_CR_LEDGER_CARD,
  defaultSalesAccountId: PARAM_DEFAULT_SALES_LEDGER,
};

export const REQUIRED_BRANCH_INTEGRATION_FIELDS = [
  'defaultCashAccountId',
  'defaultCardAccountId',
];

export function getIntegrationDefinitions() {
  return {
    tabs: INTEGRATION_TABS,
    fields: INTEGRATION_PARAMETER_DEFS.map((d) => ({
      key: d.key,
      param: d.param,
      tab: d.tab,
      label: d.label,
      type: d.type,
      required: Boolean(d.required),
      filterPrefix: d.filterPrefix || null,
      hint: d.hint || null,
      postingOnly: d.postingOnly !== false,
    })),
  };
}

export async function getParameterRow(pool, companyId, branchId, parameterName) {
  const { rows } = await pool.query(
    `SELECT account_id, numeric_value, string_value
     FROM accounts.accounts_parameter
     WHERE company_id = $1 AND branch_id = $2 AND parameter_name = $3
     LIMIT 1`,
    [companyId, branchId, parameterName],
  );
  return rows[0] || null;
}

export async function getParameterAccountId(pool, companyId, branchId, parameterName) {
  const row = await getParameterRow(pool, companyId, branchId, parameterName);
  const id = row?.account_id;
  if (id == null) return null;
  const n = Number(id);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
}

function readFieldValue(def, row) {
  if (!row) return null;
  if (def.type === 'voucher') {
    const n = row.numeric_value != null ? Number(row.numeric_value) : Number(row.account_id);
    return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
  }
  const id = row.account_id;
  if (id == null) return null;
  const n = Number(id);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
}

function readWithFallbacks(byParam, key) {
  const names = PARAMETER_READ_FALLBACKS[key];
  if (!names) return null;
  for (const paramName of names) {
    const val = readFieldValue({ type: 'ledger' }, byParam[paramName]);
    if (val) return val;
  }
  return null;
}

async function chartAccountExists(db, companyId, accountId) {
  const { rows } = await db.query(
    `SELECT 1 FROM accounts.account_head_master
     WHERE company_id = $1 AND account_id = $2
       AND (record_status IS NULL OR TRIM(UPPER(record_status)) = 'ACTIVE')
     LIMIT 1`,
    [companyId, accountId],
  );
  return rows.length > 0;
}

/** Back-fill missing branch integration rows from standard chart IDs (idempotent). */
export async function ensureBranchIntegrationDefaults(db, companyId, branchId) {
  const hasChart = await chartAccountExists(db, companyId, CHART_ACCOUNT_IDS.DEFAULT_CASH);
  if (!hasChart) return { applied: 0 };

  const ledgerDefaults = [
    [PARAM_DEFAULT_CASH_LEDGER, CHART_ACCOUNT_IDS.DEFAULT_CASH],
    [PARAM_DEFAULT_CARD_LEDGER, CHART_ACCOUNT_IDS.DEFAULT_BANK],
    ['CODRCashReceiptLedger', CHART_ACCOUNT_IDS.DEFAULT_CASH],
    ['CODRCreditCardReceiptLedger', CHART_ACCOUNT_IDS.DEFAULT_BANK],
    [PARAM_CUSTOMER_PARENT_LEDGER, CHART_ACCOUNT_IDS.DEBTORS_GROUP],
    [PARAM_SUPPLIER_PARENT_LEDGER, CHART_ACCOUNT_IDS.CREDITORS_GROUP],
    [PARAM_SALES_CR_LEDGER_CASH, CHART_ACCOUNT_IDS.DEFAULT_SALES],
    [PARAM_SALES_CR_LEDGER_CREDIT, CHART_ACCOUNT_IDS.DEFAULT_SALES],
    [PARAM_SALES_CR_LEDGER_CARD, CHART_ACCOUNT_IDS.DEFAULT_SALES],
    ['COSalesCRLedgerCredit', CHART_ACCOUNT_IDS.DEFAULT_SALES],
    ['COSalesCRLedgerCash', CHART_ACCOUNT_IDS.DEFAULT_SALES],
    ['COSalesCRLedgerCreditCard', CHART_ACCOUNT_IDS.DEFAULT_SALES],
    ['COSalesDRLedgerCash', CHART_ACCOUNT_IDS.DEFAULT_CASH],
    ['COSalesDRLedgerCreditCard', CHART_ACCOUNT_IDS.DEFAULT_BANK],
  ];

  const voucherDefaults = [
    ['ReceiptVoucherNameCustomer', 9],
    ['ReceiptVoucherName', 9],
    ['PaymentVoucherName', 4],
    ['PaymentVoucherNameSupplier', 4],
    ['SalesEntryVoucherName', 1],
    ['COSalesEntryVoucherName', 1],
    ['PurchaseEntryVoucherName', 6],
  ];

  let applied = 0;
  for (const [paramName, accountId] of ledgerDefaults) {
    const existing = await getParameterRow(db, companyId, branchId, paramName);
    if (existing?.account_id != null) continue;
    if (!(await chartAccountExists(db, companyId, accountId))) continue;
    await upsertParameter(db, {
      companyId,
      branchId,
      parameterName: paramName,
      accountId,
      numericValue: null,
      stringValue: null,
    });
    applied += 1;
  }

  for (const [paramName, voucherTypeId] of voucherDefaults) {
    const existing = await getParameterRow(db, companyId, branchId, paramName);
    if (existing?.numeric_value != null || existing?.account_id != null) continue;
    await upsertParameter(db, {
      companyId,
      branchId,
      parameterName: paramName,
      accountId: null,
      numericValue: voucherTypeId,
      stringValue: String(voucherTypeId),
    });
    applied += 1;
  }

  return { applied };
}

export async function getBranchIntegrationSettings(pool, companyId, branchId) {
  await ensureBranchIntegrationDefaults(pool, companyId, branchId);

  const { rows } = await pool.query(
    `SELECT parameter_name, account_id, numeric_value, string_value
     FROM accounts.accounts_parameter
     WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId],
  );
  const byParam = Object.fromEntries(rows.map((r) => [r.parameter_name, r]));
  const parameters = {};
  for (const def of INTEGRATION_PARAMETER_DEFS) {
    parameters[def.key] = readFieldValue(def, byParam[def.param]);
  }

  // Cross-parameter fallbacks (DEFAULT_* ↔ CODR*, payment/receipt tab)
  for (const key of Object.keys(PARAMETER_READ_FALLBACKS)) {
    if (!parameters[key]) {
      parameters[key] = readWithFallbacks(byParam, key);
    }
  }

  parameters.defaultCashAccountId =
    parameters.paymentReceiptCashLedger
    ?? parameters.codrCashReceiptLedger
    ?? readFieldValue({ type: 'ledger' }, byParam[PARAM_DEFAULT_CASH_LEDGER]);
  parameters.defaultCardAccountId =
    parameters.paymentReceiptCardLedger
    ?? parameters.codrCardReceiptLedger
    ?? readFieldValue({ type: 'ledger' }, byParam[PARAM_DEFAULT_CARD_LEDGER]);

  if (!parameters.codrCashReceiptLedger) parameters.codrCashReceiptLedger = parameters.defaultCashAccountId;
  if (!parameters.codrCardReceiptLedger) parameters.codrCardReceiptLedger = parameters.defaultCardAccountId;
  if (!parameters.paymentReceiptCashLedger) parameters.paymentReceiptCashLedger = parameters.defaultCashAccountId;
  if (!parameters.paymentReceiptCardLedger) parameters.paymentReceiptCardLedger = parameters.defaultCardAccountId;

  return parameters;
}

export function getMissingRequiredIntegrationFields(parameters) {
  return REQUIRED_INTEGRATION_KEYS.filter((key) => {
    const id = parameters?.[key];
    return id == null || !Number.isFinite(Number(id)) || Number(id) < 1;
  });
}

export async function getBranchAccountDefaults(pool, companyId, branchId) {
  const settings = await getBranchIntegrationSettings(pool, companyId, branchId);
  return {
    defaultCashAccountId: settings.defaultCashAccountId,
    defaultCardAccountId: settings.defaultCardAccountId,
  };
}

export async function upsertParameter(client, {
  companyId, branchId, parameterName, accountId, numericValue, stringValue,
}) {
  await client.query(
    `INSERT INTO accounts.accounts_parameter
       (company_id, branch_id, parameter_name, account_id, numeric_value, string_value, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (company_id, branch_id, parameter_name)
     DO UPDATE SET
       account_id = EXCLUDED.account_id,
       numeric_value = EXCLUDED.numeric_value,
       string_value = COALESCE(EXCLUDED.string_value, accounts.accounts_parameter.string_value),
       updated_at = NOW()`,
    [
      companyId,
      branchId,
      parameterName,
      accountId ?? null,
      numericValue ?? null,
      stringValue ?? null,
    ],
  );
}

async function upsertIntegrationField(client, companyId, branchId, def, rawValue) {
  if (rawValue == null || rawValue === '') return;
  const n = Math.trunc(Number(rawValue));
  if (!Number.isFinite(n) || n < 1) return;

  if (def.type === 'voucher') {
    await upsertParameter(client, {
      companyId,
      branchId,
      parameterName: def.param,
      accountId: n,
      numericValue: n,
      stringValue: String(n),
    });
  } else {
    await upsertParameter(client, {
      companyId,
      branchId,
      parameterName: def.param,
      accountId: n,
      numericValue: null,
      stringValue: null,
    });
    const aliases = PARAMETER_ALIASES_ON_SAVE[def.param] || def.aliases || [];
    for (const alias of aliases) {
      await upsertParameter(client, {
        companyId,
        branchId,
        parameterName: alias,
        accountId: n,
        numericValue: null,
        stringValue: null,
      });
    }
  }
}

/** Map UI keys that share the same underlying parameter_name. */
const SAVE_KEY_ALIASES = {
  defaultCashAccountId: 'paymentReceiptCashLedger',
  defaultCardAccountId: 'paymentReceiptCardLedger',
  codrCashReceiptLedger: 'paymentReceiptCashLedger',
  codrCardReceiptLedger: 'paymentReceiptCardLedger',
};

export async function saveBranchIntegrationSettings(client, companyId, branchId, body) {
  const normalized = { ...body };
  for (const [fromKey, toKey] of Object.entries(SAVE_KEY_ALIASES)) {
    if (normalized[toKey] == null && normalized[fromKey] != null) {
      normalized[toKey] = normalized[fromKey];
    }
    if (normalized[fromKey] == null && normalized[toKey] != null) {
      normalized[fromKey] = normalized[toKey];
    }
  }

  for (const [key, rawValue] of Object.entries(normalized)) {
    if (key === 'branchId' || key === 'ok') continue;
    const def = INTEGRATION_PARAM_BY_KEY[key];
    if (!def) continue;
    await upsertIntegrationField(client, companyId, branchId, def, rawValue);
  }
}
