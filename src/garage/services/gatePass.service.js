import { withTransaction } from '../../config/db.js';
import { requireBranchId, requireCompanyId, trimOrNull, toIntOrNull } from '../../utils/crmHelpers.js';
import * as repo from '../repositories/gatePass.repository.js';
import { nextDocNo } from '../../shared/services/docSequence.service.js';

const VALID_PASS_TYPES = ['IN', 'OUT'];

function actorLabel(a) { return trimOrNull(a?.staff_name, 50) || trimOrNull(a?.login_name, 50) || 'system'; }

function toDateOrNull(v) {
  if (v == null || v === '') return new Date().toISOString();
  const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

function buildPayload(body) {
  return {
    jobCardId: toIntOrNull(body.jobCardId),
    jcNo: trimOrNull(body.jcNo, 30),
    vehicleId: toIntOrNull(body.vehicleId),
    regNo: trimOrNull(body.regNo, 30),
    passType: VALID_PASS_TYPES.includes(body.passType) ? body.passType : 'OUT',
    passDate: toDateOrNull(body.passDate),
    kmReading: body.kmReading != null ? Number(body.kmReading) : null,
    issuedBy: trimOrNull(body.issuedBy, 100),
    remarks: trimOrNull(body.remarks, 500),
  };
}

export async function listGatePasses(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, query);
  return repo.listGatePasses(pool, companyId, branchId, {
    jobCardId: toIntOrNull(query.jobCardId),
    passType: trimOrNull(query.passType, 10),
  });
}

export async function getGatePassById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const item = await repo.findGatePassById(pool, companyId, branchId, Number(id));
  if (!item) { const e = new Error('Gate pass not found'); e.status = 404; throw e; }
  return item;
}

export async function createGatePass(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  return withTransaction(async (client) => {
    const gpNo = await nextDocNo(client, { companyId, branchId, sequenceCode: 'GATE_PASS', fiscalYear: new Date().getFullYear() });
    return repo.insertGatePass(client, { companyId, branchId, gpNo, ...buildPayload(body), createdBy: actorLabel(authStaff) });
  });
}
