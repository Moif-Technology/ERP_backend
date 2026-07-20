import { withTransaction } from '../../config/db.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as designationRepo from '../repositories/designation.repository.js';

function parseBranchId(authStaff, branchIdQueryOrBody) {
  const candidate = branchIdQueryOrBody ?? authStaff.branch_id;
  const n = Number(candidate);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

async function resolveTenant(pool, authStaff, branchInput) {
  const companyId = Number(authStaff.company_id);
  const branchId = parseBranchId(authStaff, branchInput);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid session company');
    err.status = 401;
    throw err;
  }
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
  return { companyId, branchId };
}

export async function listDesignations(pool, authStaff, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  return designationRepo.listDesignations(pool, companyId, branchId);
}

export async function createDesignation(pool, authStaff, body) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, body?.branchId);
  const designationName = String(body?.designationName || '').trim().slice(0, 80);
  if (!designationName) {
    const err = new Error('designationName is required');
    err.status = 400;
    throw err;
  }
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `core.designation_master:${companyId}:${branchId}`,
    ]);
    const designationId = await designationRepo.nextDesignationId(client, companyId, branchId);
    return designationRepo.insertDesignation(client, { companyId, branchId, designationId, designationName });
  });
}

export async function deleteDesignation(pool, authStaff, designationId, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  const id = Number(designationId);
  if (!Number.isFinite(id) || id < 1) {
    const err = new Error('Valid designationId is required');
    err.status = 400;
    throw err;
  }
  return designationRepo.deleteDesignation(pool, companyId, branchId, id);
}
