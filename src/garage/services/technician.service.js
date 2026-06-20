import { withTransaction } from '../../config/db.js';
import { requireBranchId, requireCompanyId, trimOrNull, requiredStr } from '../../utils/crmHelpers.js';
import * as repo from '../repositories/technician.repository.js';
import { nextDocNo } from '../../shared/services/docSequence.service.js';

const VALID_STATUSES = ['ACTIVE', 'INACTIVE'];

function actorLabel(authStaff) {
  return trimOrNull(authStaff?.staff_name, 50) || trimOrNull(authStaff?.login_name, 50) || 'system';
}

function buildPayload(body) {
  return {
    empId: trimOrNull(body.empId, 30),
    techName: requiredStr(body.techName, 'Technician name', 150),
    specialisation: trimOrNull(body.specialisation, 100),
    phone: trimOrNull(body.phone, 30),
    status: VALID_STATUSES.includes(body.status) ? body.status : 'ACTIVE',
  };
}

export async function listTechnicians(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, query);
  return repo.listTechnicians(pool, companyId, branchId, trimOrNull(query.q, 100));
}

export async function getTechnicianById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const item = await repo.findTechnicianById(pool, companyId, branchId, Number(id));
  if (!item) { const e = new Error('Technician not found'); e.status = 404; throw e; }
  return item;
}

export async function createTechnician(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const payload = buildPayload(body);
  return withTransaction(async (client) => {
    if (!payload.empId && body.autoCode) {
      payload.empId = await nextDocNo(client, { companyId, branchId, sequenceCode: 'TECHNICIAN' });
    }
    return repo.insertTechnician(client, { companyId, branchId, ...payload, createdBy: actorLabel(authStaff) });
  });
}

export async function updateTechnician(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const payload = buildPayload(body);
  const updated = await repo.updateTechnician(pool, companyId, branchId, Number(id), {
    ...payload, modifiedBy: actorLabel(authStaff),
  });
  if (!updated) { const e = new Error('Technician not found'); e.status = 404; throw e; }
  return updated;
}

export async function deleteTechnician(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const ok = await repo.deleteTechnician(pool, companyId, branchId, Number(id), actorLabel(authStaff));
  if (!ok) { const e = new Error('Technician not found'); e.status = 404; throw e; }
}
