import { requireBranchId, requireCompanyId, trimOrNull, requiredStr, toNumberOrNull } from '../../utils/crmHelpers.js';
import * as repo from '../../repositories/garage/jobDescription.repository.js';

const VALID_STATUSES = ['ACTIVE', 'INACTIVE'];

function actorLabel(a) {
  return trimOrNull(a?.staff_name, 50) || trimOrNull(a?.login_name, 50) || 'system';
}

function toNonNeg(v) {
  const n = toNumberOrNull ? toNumberOrNull(v) : (v == null ? null : Number(v));
  return n == null || n < 0 ? 0 : n;
}

function buildPayload(body) {
  return {
    jobCode: requiredStr(body.jobCode, 'Job code', 30),
    description: requiredStr(body.description, 'Description', 500),
    stdTime: toNonNeg(body.stdTime),
    unitCost: toNonNeg(body.unitCost),
    sellingPrice: toNonNeg(body.sellingPrice),
    status: VALID_STATUSES.includes(body.status) ? body.status : 'ACTIVE',
  };
}

export async function listJobDescriptions(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, query);
  return repo.listJobDescriptions(pool, companyId, branchId, trimOrNull(query.q, 100));
}

export async function getJobDescriptionById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const item = await repo.findJobDescriptionById(pool, companyId, branchId, Number(id));
  if (!item) { const e = new Error('Job description not found'); e.status = 404; throw e; }
  return item;
}

export async function createJobDescription(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  return repo.insertJobDescription(pool, { companyId, branchId, ...buildPayload(body), createdBy: actorLabel(authStaff) });
}

export async function updateJobDescription(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const updated = await repo.updateJobDescription(pool, companyId, branchId, Number(id), {
    ...buildPayload(body), modifiedBy: actorLabel(authStaff),
  });
  if (!updated) { const e = new Error('Job description not found'); e.status = 404; throw e; }
  return updated;
}

export async function deleteJobDescription(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const ok = await repo.deleteJobDescription(pool, companyId, branchId, Number(id), actorLabel(authStaff));
  if (!ok) { const e = new Error('Job description not found'); e.status = 404; throw e; }
}
