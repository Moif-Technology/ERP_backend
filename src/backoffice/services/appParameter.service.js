import { pool } from '../../config/db.js';
import * as appParameterRepo from '../repositories/appParameter.repository.js';

function parseBranchId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

/** Public gvtax — government VAT % for product pricing (from parameter table / company settings). */
export async function getGvTax(authStaff, query = {}) {
  const companyId = Number(authStaff.company_id);
  const branchId = parseBranchId(query.branchId) ?? parseBranchId(authStaff.branch_id);
  const gvtax = await appParameterRepo.resolveGvTaxRate(pool, companyId, branchId);
  const currencyPrecision = await appParameterRepo.resolveCurrencyPrecision(pool, companyId, branchId);
  const autoRoundOff = await appParameterRepo.resolveAutoRoundOff(pool, companyId, branchId);
  const receiptHeader = await appParameterRepo.resolveReceiptCompanyHeader(pool, companyId, branchId);
  return { gvtax, currencyPrecision, autoRoundOff, receiptHeader };
}
