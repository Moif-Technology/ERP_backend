import { withTransaction } from '../../config/db.js';
import {
  requireBranchId,
  requireCompanyId,
  toIntOrNull,
  toNumberOrNull,
  trimOrNull,
} from '../../utils/crmHelpers.js';
import * as repo from '../repositories/estimation.repository.js';
import { findJobCardById } from '../repositories/jobCard.repository.js';
import { nextDocNo } from '../../shared/services/docSequence.service.js';

const VALID_CLAIM_TYPES = ['OWN CLAIM', 'THIRD PARTY', 'COMPREHENSIVE', 'TPL', 'CASH'];
const VALID_LINE_TYPES = ['REPAIR', 'SPARE'];
const VALID_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'REVISED'];

function toDateOrToday(v) {
  if (v == null || v === '') return new Date().toISOString().slice(0, 10);
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function toBool(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function toNonNeg(v) {
  const n = toNumberOrNull(v);
  return n == null || n < 0 ? 0 : n;
}

function actorLabel(authStaff) {
  return trimOrNull(authStaff?.staff_name, 50) || trimOrNull(authStaff?.login_name, 50) || 'system';
}

function buildLines(rawLines) {
  if (!Array.isArray(rawLines)) return [];
  return rawLines
    .map((line) => {
      const lineType = String(line.lineType || '').toUpperCase();
      const qty = Math.max(toNonNeg(line.qty), lineType === 'REPAIR' ? 1 : 0);
      const rate = toNonNeg(line.rate);
      const amount = toNonNeg(line.amount || qty * rate);
      return {
        lineType: VALID_LINE_TYPES.includes(lineType) ? lineType : null,
        description: trimOrNull(line.description, 500),
        qty,
        rate,
        amount,
        spareType: trimOrNull(line.spareType, 30),
      };
    })
    .filter((line) => line.lineType && line.description);
}

function buildPayload(body) {
  const lines = buildLines(body.lines);
  const totalRepairs = lines.filter((l) => l.lineType === 'REPAIR').reduce((sum, l) => sum + l.amount, 0);
  const totalSpares = lines.filter((l) => l.lineType === 'SPARE').reduce((sum, l) => sum + l.amount, 0);
  const discount = toNonNeg(body.discount);
  const vat = toNonNeg(body.vat);
  const estimationAmount = Math.max(totalRepairs + totalSpares - discount + vat, 0);
  return {
    estimationDate: toDateOrToday(body.estimationDate),
    jobCardId: toIntOrNull(body.jobCardId),
    vehicleId: toIntOrNull(body.vehicleId),
    customerId: toIntOrNull(body.customerId),
    regNo: trimOrNull(body.regNo, 30),
    chassisNo: trimOrNull(body.chassisNo, 50),
    customerName: trimOrNull(body.customerName, 150),
    contactPerson: trimOrNull(body.contactPerson, 150),
    customerRefNo: trimOrNull(body.customerRefNo, 50),
    claimType: VALID_CLAIM_TYPES.includes(body.claimType) ? body.claimType : null,
    estimator: trimOrNull(body.estimator, 100),
    model: trimOrNull(body.model, 50),
    bodyColour: trimOrNull(body.bodyColour, 50),
    kmReading: toNonNeg(body.kmReading),
    totalRepairs,
    totalSpares,
    discount,
    vat,
    estimationAmount,
    approvalAmount: toNonNeg(body.approvalAmount),
    lpoClaimNo: trimOrNull(body.lpoClaimNo, 50),
    estimationStatus: VALID_STATUSES.includes(body.estimationStatus) ? body.estimationStatus : 'PENDING',
    remark: trimOrNull(body.remark, 5000),
    additionalEstimation: toBool(body.additionalEstimation),
    totalLoss: toBool(body.totalLoss),
    lines,
  };
}

async function hydrateFromJobCard(pool, companyId, branchId, payload) {
  if (!payload.jobCardId) return payload;
  const jobCard = await findJobCardById(pool, companyId, branchId, payload.jobCardId);
  if (!jobCard) {
    const err = new Error('Linked job card not found'); err.status = 404; throw err;
  }
  return {
    ...payload,
    vehicleId: payload.vehicleId || jobCard.vehicleId,
    regNo: payload.regNo || jobCard.regNo,
    chassisNo: payload.chassisNo || jobCard.chassisNo,
    customerId: payload.customerId || jobCard.customerId,
    customerName: payload.customerName || jobCard.customerName || jobCard.vehOwnerName,
    kmReading: payload.kmReading || jobCard.kmReadingIn || 0,
  };
}

export async function listEstimations(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, query);
  return repo.listEstimations(pool, companyId, branchId, trimOrNull(query.q, 120));
}

export async function getEstimationById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const item = await repo.findEstimationById(pool, companyId, branchId, Number(id));
  if (!item) {
    const err = new Error('Estimation not found'); err.status = 404; throw err;
  }
  return item;
}

export async function createEstimation(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const createdBy = actorLabel(authStaff);
  const basePayload = buildPayload(body);
  const payload = await hydrateFromJobCard(pool, companyId, branchId, basePayload);
  if (!payload.regNo) {
    const err = new Error('Reg. No. is required'); err.status = 400; throw err;
  }
  if (!payload.customerName && !payload.customerId) {
    const err = new Error('Customer is required'); err.status = 400; throw err;
  }

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `garage.estimation:${companyId}:${branchId}`,
    ]);
    const estimationNo = await nextDocNo(client, { companyId, branchId, sequenceCode: 'ESTIMATION', fiscalYear: new Date().getFullYear() });
    const header = await repo.insertEstimation(client, {
      companyId, branchId, estimationNo, ...payload, createdBy,
    });
    const lines = await repo.insertEstimationLines(client, header.id, companyId, payload.lines);
    await repo.linkJobCardEstimation(
      client,
      companyId,
      branchId,
      payload.jobCardId,
      header.id,
      header.estimationNo,
      header.estimationAmount,
      payload.vehicleId
    );
    return { ...header, lines };
  });
}

export async function updateEstimation(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const modifiedBy = actorLabel(authStaff);
  const basePayload = buildPayload(body);
  const payload = await hydrateFromJobCard(pool, companyId, branchId, basePayload);

  return withTransaction(async (client) => {
    const header = await repo.updateEstimation(client, companyId, branchId, Number(id), {
      ...payload, modifiedBy,
    });
    if (!header) {
      const err = new Error('Estimation not found'); err.status = 404; throw err;
    }
    const lines = await repo.replaceEstimationLines(client, header.id, companyId, payload.lines);
    await repo.linkJobCardEstimation(
      client,
      companyId,
      branchId,
      payload.jobCardId,
      header.id,
      header.estimationNo,
      header.estimationAmount,
      payload.vehicleId
    );
    return { ...header, lines };
  });
}

export async function postEstimation(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const modifiedBy = actorLabel(authStaff);
  const existing = await repo.findEstimationById(pool, companyId, branchId, Number(id));
  if (!existing) {
    const err = new Error('Estimation not found'); err.status = 404; throw err;
  }
  if (existing.status === 'POSTED') {
    const err = new Error('Estimation is already posted'); err.status = 409; throw err;
  }
  return repo.setEstimationStatus(pool, companyId, branchId, Number(id), 'POSTED', modifiedBy);
}

export async function unpostEstimation(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const modifiedBy = actorLabel(authStaff);
  const existing = await repo.findEstimationById(pool, companyId, branchId, Number(id));
  if (!existing) {
    const err = new Error('Estimation not found'); err.status = 404; throw err;
  }
  if (existing.status !== 'POSTED') {
    const err = new Error('Estimation is not posted'); err.status = 409; throw err;
  }
  return repo.setEstimationStatus(pool, companyId, branchId, Number(id), 'OPEN', modifiedBy);
}
