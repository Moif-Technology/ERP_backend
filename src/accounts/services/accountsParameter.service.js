import { withTransaction } from '../../config/db.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as accountsParameterRepo from '../repositories/accountsParameter.repository.js';
import * as accountHeadRepo from '../repositories/accountHead.repository.js';

function parseBranchId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
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
  const d = await accountsParameterRepo.getBranchAccountDefaults(pool, companyId, branchId);
  return {
    branchId,
    defaultCashAccountId: d.defaultCashAccountId,
    defaultCardAccountId: d.defaultCardAccountId,
  };
}

export async function updateBranchDefaults(pool, authStaff, body) {
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

  const cashId =
    body.defaultCashAccountId != null && body.defaultCashAccountId !== ''
      ? Math.trunc(Number(body.defaultCashAccountId))
      : null;
  const cardId =
    body.defaultCardAccountId != null && body.defaultCardAccountId !== ''
      ? Math.trunc(Number(body.defaultCardAccountId))
      : null;

  if (cashId != null && cashId >= 1) {
    const row = await accountHeadRepo.findAccountHead(pool, companyId, cashId);
    if (!row) {
      const err = new Error('defaultCashAccountId is not a valid account head for this company');
      err.status = 400;
      throw err;
    }
  }
  if (cardId != null && cardId >= 1) {
    const row = await accountHeadRepo.findAccountHead(pool, companyId, cardId);
    if (!row) {
      const err = new Error('defaultCardAccountId is not a valid account head for this company');
      err.status = 400;
      throw err;
    }
  }

  return withTransaction(async (client) => {
    if (cashId != null && cashId >= 1) {
      await accountsParameterRepo.upsertParameter(client, {
        companyId,
        branchId,
        parameterName: accountsParameterRepo.PARAM_DEFAULT_CASH_LEDGER,
        accountId: cashId,
      });
    }
    if (cardId != null && cardId >= 1) {
      await accountsParameterRepo.upsertParameter(client, {
        companyId,
        branchId,
        parameterName: accountsParameterRepo.PARAM_DEFAULT_CARD_LEDGER,
        accountId: cardId,
      });
    }
    const d = await accountsParameterRepo.getBranchAccountDefaults(client, companyId, branchId);
    return {
      ok: true,
      branchId,
      defaultCashAccountId: d.defaultCashAccountId,
      defaultCardAccountId: d.defaultCardAccountId,
    };
  });
}
