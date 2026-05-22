import { requireBranchId, requireCompanyId, trimOrNull, toIntOrNull } from '../../utils/crmHelpers.js';
import * as repo from '../../repositories/garage/lubricant.repository.js';

function actorLabel(a) { return trimOrNull(a?.staff_name, 50) || trimOrNull(a?.login_name, 50) || 'system'; }
function toNonNeg(v) { const n = v == null ? null : Number(v); return n == null || Number.isNaN(n) || n < 0 ? 0 : n; }

function buildPayload(body) {
  const qty = toNonNeg(body.qty);
  const unitCost = toNonNeg(body.unitCost);
  return {
    jobCardId: toIntOrNull(body.jobCardId),
    jcNo: trimOrNull(body.jcNo, 30),
    productId: toIntOrNull(body.productId),
    productCode: trimOrNull(body.productCode, 50),
    description: trimOrNull(body.description, 300),
    unitName: trimOrNull(body.unitName, 30),
    qty,
    unitCost,
    totalCost: body.totalCost != null ? toNonNeg(body.totalCost) : qty * unitCost,
  };
}

export async function listLubricants(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, query);
  return repo.listLubricants(pool, companyId, branchId, toIntOrNull(query.jobCardId));
}

export async function getLubricantById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const item = await repo.findLubricantById(pool, companyId, branchId, Number(id));
  if (!item) { const e = new Error('Lubricant record not found'); e.status = 404; throw e; }
  return item;
}

export async function createLubricant(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  return repo.insertLubricant(pool, { companyId, branchId, ...buildPayload(body), createdBy: actorLabel(authStaff) });
}

export async function updateLubricant(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const updated = await repo.updateLubricant(pool, companyId, branchId, Number(id), {
    ...buildPayload(body), modifiedBy: actorLabel(authStaff),
  });
  if (!updated) { const e = new Error('Lubricant record not found'); e.status = 404; throw e; }
  return updated;
}

export async function deleteLubricant(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const ok = await repo.deleteLubricant(pool, companyId, branchId, Number(id));
  if (!ok) { const e = new Error('Lubricant record not found'); e.status = 404; throw e; }
}
