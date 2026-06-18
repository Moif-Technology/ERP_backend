import { requireBranchId, requireCompanyId, trimOrNull, toIntOrNull } from '../../utils/crmHelpers.js';
import * as repo from '../repositories/subletLpo.repository.js';

function actorLabel(a) {
  return trimOrNull(a?.staff_name, 50) || trimOrNull(a?.login_name, 50) || 'system';
}

function toNonNeg(v) {
  const n = v == null ? null : Number(v);
  return n == null || Number.isNaN(n) || n < 0 ? 0 : n;
}

function toDateOrNull(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

function buildPayload(body) {
  return {
    subletJobId: toIntOrNull(body.subletJobId),
    vendorId: toIntOrNull(body.vendorId),
    vendorName: trimOrNull(body.vendorName, 150),
    lpoDate: toDateOrNull(body.lpoDate) ?? new Date().toISOString().slice(0, 10),
    amount: toNonNeg(body.amount),
  };
}

export async function listSubletLpos(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, query);
  return repo.listSubletLpos(pool, companyId, branchId, {
    subletJobId: toIntOrNull(query.subletJobId),
    status: trimOrNull(query.status, 20),
  });
}

export async function getSubletLpoById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const item = await repo.findSubletLpoById(pool, companyId, branchId, Number(id));
  if (!item) { const e = new Error('Sublet LPO not found'); e.status = 404; throw e; }
  return item;
}

export async function createSubletLpo(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const lpoNo = await repo.nextLpoNo(pool, companyId, branchId);
  return repo.insertSubletLpo(pool, { companyId, branchId, lpoNo, ...buildPayload(body), createdBy: actorLabel(authStaff) });
}

export async function updateSubletLpo(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const updated = await repo.updateSubletLpo(pool, companyId, branchId, Number(id), {
    ...buildPayload(body), modifiedBy: actorLabel(authStaff),
  });
  if (!updated) { const e = new Error('Sublet LPO not found or already posted'); e.status = 404; throw e; }
  return updated;
}

export async function postSubletLpo(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const item = await repo.findSubletLpoById(pool, companyId, branchId, Number(id));
  if (!item) { const e = new Error('Sublet LPO not found'); e.status = 404; throw e; }
  if (item.status === 'POSTED') { const e = new Error('Already posted'); e.status = 409; throw e; }
  return repo.setSubletLpoStatus(pool, companyId, branchId, Number(id), 'POSTED', actorLabel(authStaff));
}
