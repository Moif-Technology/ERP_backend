import { requireBranchId, requireCompanyId, trimOrNull, toIntOrNull } from '../../utils/crmHelpers.js';
import * as repo from '../repositories/punching.repository.js';

const VALID_STATUSES = ['OPEN', 'CLOSED', 'CANCELLED'];

function actorLabel(a) {
  return trimOrNull(a?.staff_name, 50) || trimOrNull(a?.login_name, 50) || 'system';
}

function toDateOrNull(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function calcActualHours(start, end) {
  if (!start || !end) return null;
  const diff = (new Date(end) - new Date(start)) / 3600000;
  return diff > 0 ? Math.round(diff * 100) / 100 : null;
}

function buildPayload(body) {
  const startTime = toDateOrNull(body.startTime);
  const endTime = toDateOrNull(body.endTime);
  return {
    jobCardId: toIntOrNull(body.jobCardId),
    jcNo: trimOrNull(body.jcNo, 30),
    technicianId: toIntOrNull(body.technicianId),
    jobCode: trimOrNull(body.jobCode, 30),
    startTime,
    endTime,
    actualHours: body.actualHours != null ? Number(body.actualHours) : calcActualHours(startTime, endTime),
    remarks: trimOrNull(body.remarks, 500),
    status: VALID_STATUSES.includes(body.status) ? body.status : 'OPEN',
  };
}

export async function listPunchings(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, query);
  return repo.listPunchings(pool, companyId, branchId, {
    jobCardId: toIntOrNull(query.jobCardId),
    technicianId: toIntOrNull(query.technicianId),
    status: trimOrNull(query.status, 20),
  });
}

export async function getPunchingById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const item = await repo.findPunchingById(pool, companyId, branchId, Number(id));
  if (!item) { const e = new Error('Punching record not found'); e.status = 404; throw e; }
  return item;
}

export async function getPunchingsByJobCard(pool, jcNo, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  return repo.listPunchingsByJobCard(pool, companyId, branchId, jcNo);
}

export async function createPunching(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  return repo.insertPunching(pool, { companyId, branchId, ...buildPayload(body), createdBy: actorLabel(authStaff) });
}

export async function updatePunching(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const payload = buildPayload(body);
  const updated = await repo.updatePunching(pool, companyId, branchId, Number(id), {
    ...payload, modifiedBy: actorLabel(authStaff),
  });
  if (!updated) { const e = new Error('Punching record not found'); e.status = 404; throw e; }
  return updated;
}

export async function cancelPunching(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const ok = await repo.cancelPunching(pool, companyId, branchId, Number(id), actorLabel(authStaff));
  if (!ok) { const e = new Error('Punching record not found'); e.status = 404; throw e; }
}
