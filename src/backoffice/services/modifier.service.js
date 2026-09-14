import * as modifierRepo from '../repositories/modifier.repository.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';

function parseBranchId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

export async function listModifiers(pool, authStaff, branchIdQuery) {
  const companyId = Number(authStaff.company_id);
  let bid = parseBranchId(branchIdQuery);
  if (bid == null) {
    bid = parseBranchId(authStaff.branch_id);
  }
  if (bid == null) {
    const err = new Error('branchId is required (query branchId or set staff default branch)');
    err.status = 400;
    throw err;
  }
  const ok = await branchRepo.branchBelongsToCompany(pool, companyId, bid);
  if (!ok) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }
  return modifierRepo.listModifiersByCompanyAndBranch(pool, companyId, bid);
}
