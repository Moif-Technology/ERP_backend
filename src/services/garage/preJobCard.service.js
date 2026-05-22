import { withTransaction } from '../../config/db.js';
import {
  requireBranchId,
  requireCompanyId,
  toNumberOrNull,
  trimOrNull,
} from '../../utils/crmHelpers.js';
import * as repo from '../../repositories/garage/preJobCard.repository.js';

function toDateOrNull(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

function toTimeOrNull(v) {
  if (v == null || v === '') return null;
  return String(v).trim().slice(0, 8) || null;
}

function buildPayload(body) {
  return {
    regNo: String(body.regNo ?? '').trim().toUpperCase().slice(0, 30),
    chassisNo: trimOrNull(body.chassisNo, 50),
    customerName: trimOrNull(body.customerName, 150),
    serviceAdvisor: trimOrNull(body.serviceAdvisor, 100),
    bookingDate: toDateOrNull(body.bookingDate) ?? new Date().toISOString().slice(0, 10),
    bookingTime: toTimeOrNull(body.bookingTime),
    kmReading: toNumberOrNull(body.kmReading),
    remarks: trimOrNull(body.remarks, 2000),
    policeReport: body.policeReport === true || body.policeReport === 'true',
    warrantyRepair: body.warrantyRepair === true || body.warrantyRepair === 'true',
    totalLoss: body.totalLoss === true || body.totalLoss === 'true',
  };
}

function actorLabel(authStaff) {
  return trimOrNull(authStaff?.staff_name, 50) || trimOrNull(authStaff?.login_name, 50) || 'system';
}

export async function listPreJobCards(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, query);
  const search = trimOrNull(query.q, 120);
  return repo.listPreJobCards(pool, companyId, branchId, search);
}

export async function getPreJobCardById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const rec = await repo.findPreJobCardById(pool, companyId, branchId, Number(id));
  if (!rec) {
    const err = new Error('Pre job card not found'); err.status = 404; throw err;
  }
  return rec;
}

export async function searchByRegNo(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, query);
  const regNo = trimOrNull(query.regNo, 30);
  if (!regNo) {
    const err = new Error('regNo is required'); err.status = 400; throw err;
  }
  return repo.findPreJobCardByRegNo(pool, companyId, branchId, regNo);
}

export async function createPreJobCard(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const payload = buildPayload(body);
  if (!payload.regNo) {
    const err = new Error('regNo is required'); err.status = 400; throw err;
  }
  const createdBy = actorLabel(authStaff);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `garage.pre_job_card:${companyId}:${branchId}`,
    ]);
    const preJcId = await repo.nextPreJcId(client, companyId, branchId);
    return repo.insertPreJobCard(client, { companyId, branchId, preJcId, ...payload, createdBy });
  });
}

export async function updatePreJobCard(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const payload = buildPayload(body);
  if (!payload.regNo) {
    const err = new Error('regNo is required'); err.status = 400; throw err;
  }
  const modifiedBy = actorLabel(authStaff);
  const updated = await repo.updatePreJobCard(pool, companyId, branchId, Number(id), {
    ...payload, modifiedBy,
  });
  if (!updated) {
    const err = new Error('Pre job card not found'); err.status = 404; throw err;
  }
  return updated;
}
