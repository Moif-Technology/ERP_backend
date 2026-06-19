import { withTransaction } from '../../config/db.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as accountsParameterRepo from '../repositories/accountsParameter.repository.js';
import * as accountHeadRepo from '../repositories/accountHead.repository.js';
import { INTEGRATION_PARAM_BY_KEY } from '../config/integrationParameters.js';

function parseBranchId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

function parseAccountId(raw) {
  if (raw == null || raw === '') return null;
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : null;
}

function buildIntegrationResponse(branchId, parameters) {
  const missingRequired = accountsParameterRepo.getMissingRequiredIntegrationFields(parameters);
  return {
    branchId,
    parameters,
    definitions: accountsParameterRepo.getIntegrationDefinitions(),
    integrationComplete: missingRequired.length === 0,
    missingRequired,
    // Legacy flat fields for Sale.jsx etc.
    defaultCashAccountId: parameters.defaultCashAccountId ?? parameters.codrCashReceiptLedger ?? null,
    defaultCardAccountId: parameters.defaultCardAccountId ?? parameters.codrCardReceiptLedger ?? null,
    customerParentAccountId: parameters.customerParentAccountId ?? null,
    supplierParentAccountId: parameters.supplierParentAccountId ?? null,
    salesCashAccountId: parameters.boSalesCrLedgerCash ?? null,
    salesCreditAccountId: parameters.boSalesCrLedgerCredit ?? null,
    salesCreditCardAccountId: parameters.boSalesCrLedgerCreditCard ?? null,
    defaultSalesAccountId: parameters.boSalesCrLedgerCredit ?? null,
  };
}

async function validateIntegrationValues(pool, companyId, body) {
  for (const [key, rawValue] of Object.entries(body)) {
    const def = INTEGRATION_PARAM_BY_KEY[key];
    if (!def || rawValue == null || rawValue === '') continue;
    const n = parseAccountId(rawValue);
    if (n == null) continue;
    if (def.type === 'voucher') {
      const { rows } = await pool.query(
        `SELECT 1 FROM accounts.voucher_type_master
         WHERE company_id = $1 AND voucher_type_id = $2 LIMIT 1`,
        [companyId, n],
      );
      if (!rows.length) {
        const err = new Error(`${def.label} is not a valid voucher type`);
        err.status = 400;
        throw err;
      }
    } else {
      const row = await accountHeadRepo.findAccountHead(pool, companyId, n);
      if (!row) {
        const err = new Error(`${def.label} is not a valid account for this company`);
        err.status = 400;
        throw err;
      }
    }
  }
}

export async function getBranchDefaults(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid company on session');
    err.status = 400;
    throw err;
  }
  const branchId = parseBranchId(query.branchId ?? authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const ok = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!ok) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }
  const parameters = await accountsParameterRepo.getBranchIntegrationSettings(pool, companyId, branchId);
  return buildIntegrationResponse(branchId, parameters);
}

export async function getBranchIntegration(pool, authStaff, query) {
  return getBranchDefaults(pool, authStaff, query);
}

export async function updateBranchDefaults(pool, authStaff, body) {
  return updateBranchIntegration(pool, authStaff, body);
}

export async function updateBranchIntegration(pool, authStaff, body) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid company on session');
    err.status = 400;
    throw err;
  }
  const branchId = parseBranchId(body.branchId);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const ok = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!ok) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }

  const existing = await accountsParameterRepo.getBranchIntegrationSettings(pool, companyId, branchId);

  const cashId = parseAccountId(
    body.codrCashReceiptLedger
    ?? body.paymentReceiptCashLedger
    ?? body.defaultCashAccountId
    ?? existing.codrCashReceiptLedger
    ?? existing.paymentReceiptCashLedger
    ?? existing.defaultCashAccountId,
  );
  const cardId = parseAccountId(
    body.codrCardReceiptLedger
    ?? body.paymentReceiptCardLedger
    ?? body.defaultCardAccountId
    ?? existing.codrCardReceiptLedger
    ?? existing.paymentReceiptCardLedger
    ?? existing.defaultCardAccountId,
  );
  if (cashId == null || cardId == null) {
    const err = new Error(
      'Cash and card ledgers are required. Open Payment / Receipt tab and set Cash ledger and Card / bank ledger, or load the standard chart.',
    );
    err.status = 400;
    throw err;
  }

  const mergedBody = {
    ...existing,
    ...body,
    codrCashReceiptLedger: cashId,
    codrCardReceiptLedger: cardId,
    paymentReceiptCashLedger: cashId,
    paymentReceiptCardLedger: cardId,
    defaultCashAccountId: cashId,
    defaultCardAccountId: cardId,
  };

  await validateIntegrationValues(pool, companyId, mergedBody);

  return withTransaction(async (client) => {
    await accountsParameterRepo.saveBranchIntegrationSettings(client, companyId, branchId, mergedBody);

    const parameters = await accountsParameterRepo.getBranchIntegrationSettings(client, companyId, branchId);
    return {
      ok: true,
      ...buildIntegrationResponse(branchId, parameters),
    };
  });
}
