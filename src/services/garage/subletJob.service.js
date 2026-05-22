import { requireBranchId, requireCompanyId, trimOrNull, toIntOrNull } from '../../utils/crmHelpers.js';
import * as repo from '../../repositories/garage/subletJob.repository.js';

function actorLabel(a) {
  return trimOrNull(a?.staff_name, 50) || trimOrNull(a?.login_name, 50) || 'system';
}

function toNonNeg(v) {
  const n = v == null ? null : Number(v);
  return n == null || Number.isNaN(n) || n < 0 ? 0 : n;
}

function buildPayload(body) {
  return {
    jobCardId: toIntOrNull(body.jobCardId),
    jcNo: trimOrNull(body.jcNo, 30),
    vendorId: toIntOrNull(body.vendorId),
    vendorName: trimOrNull(body.vendorName, 150),
    description: trimOrNull(body.description, 500),
    amount: toNonNeg(body.amount),
  };
}

export async function listSubletJobs(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, query);
  return repo.listSubletJobs(pool, companyId, branchId, {
    jobCardId: toIntOrNull(query.jobCardId),
    status: trimOrNull(query.status, 20),
  });
}

export async function getSubletJobById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const item = await repo.findSubletJobById(pool, companyId, branchId, Number(id));
  if (!item) { const e = new Error('Sublet job not found'); e.status = 404; throw e; }
  return item;
}

export async function createSubletJob(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const subletNo = await repo.nextSubletNo(pool, companyId, branchId);
  return repo.insertSubletJob(pool, { companyId, branchId, subletNo, ...buildPayload(body), createdBy: actorLabel(authStaff) });
}

export async function updateSubletJob(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const updated = await repo.updateSubletJob(pool, companyId, branchId, Number(id), {
    ...buildPayload(body), modifiedBy: actorLabel(authStaff),
  });
  if (!updated) { const e = new Error('Sublet job not found or already posted'); e.status = 404; throw e; }
  return updated;
}

export async function postSubletJob(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const item = await repo.findSubletJobById(pool, companyId, branchId, Number(id));
  if (!item) { const e = new Error('Sublet job not found'); e.status = 404; throw e; }
  if (item.status === 'POSTED') { const e = new Error('Already posted'); e.status = 409; throw e; }
  return repo.setSubletJobStatus(pool, companyId, branchId, Number(id), 'POSTED', actorLabel(authStaff));
}

export async function cancelSubletJob(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const updated = await repo.setSubletJobStatus(pool, companyId, branchId, Number(id), 'CANCELLED', actorLabel(authStaff));
  if (!updated) { const e = new Error('Sublet job not found'); e.status = 404; throw e; }
  return updated;
}
