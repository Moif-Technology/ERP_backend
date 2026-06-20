import { withTransaction } from '../../config/db.js';
import {
  requireBranchId,
  requireCompanyId,
  toIntOrNull,
  toNumberOrNull,
  trimOrNull,
} from '../../utils/crmHelpers.js';
import * as repo from '../repositories/partRequest.repository.js';
import { nextDocNo } from '../../shared/services/docSequence.service.js';

function toDateOrNull(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
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
  return rawLines.map((l) => ({
    productId:    toIntOrNull(l.productId),
    productCode:  trimOrNull(l.productCode, 50),
    description:  trimOrNull(l.description, 500),
    unitName:     trimOrNull(l.unitName, 30),
    packQty:      toNonNeg(l.packQty),
    qtyRequested: toNonNeg(l.qtyRequested),
    unitCost:     toNonNeg(l.unitCost),
  }));
}

export async function listPartRequests(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId  = requireBranchId(authStaff, query);
  return repo.listPartRequests(pool, companyId, branchId, {
    status:    query.status   || null,
    jobCardId: query.jobCardId ? Number(query.jobCardId) : null,
    q:         trimOrNull(query.q, 120),
    dateFrom:  toDateOrNull(query.dateFrom),
    dateTo:    toDateOrNull(query.dateTo),
  });
}

export async function getPartRequestById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId  = requireBranchId(authStaff, {});
  const pr = await repo.findPartRequestById(pool, companyId, branchId, Number(id));
  if (!pr) { const err = new Error('Part request not found'); err.status = 404; throw err; }
  return pr;
}

export async function createPartRequest(pool, body, authStaff) {
  const companyId  = requireCompanyId(authStaff);
  const branchId   = requireBranchId(authStaff, body);
  const createdBy  = actorLabel(authStaff);
  const lines      = buildLines(body.lines);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `garage.part_request:${companyId}:${branchId}`,
    ]);
    const requestNo = await nextDocNo(client, { companyId, branchId, sequenceCode: 'PART_REQUEST', fiscalYear: new Date().getFullYear() });
    const header = await repo.insertPartRequest(client, {
      companyId,
      branchId,
      requestNo,
      jobCardId:   toIntOrNull(body.jobCardId),
      jcNo:        trimOrNull(body.jcNo, 30),
      requestDate: toDateOrNull(body.requestDate) ?? new Date().toISOString().slice(0, 10),
      expectedDeliveryDate: toDateOrNull(body.expectedDeliveryDate),
      requestedBy: trimOrNull(body.requestedBy, 100),
      technicianId: toIntOrNull(body.technicianId),
      workshopId:   toIntOrNull(body.workshopId),
      internalInvoiceNo: toIntOrNull(body.internalInvoiceNo),
      remarks:     trimOrNull(body.remarks, 2000),
      createdBy,
    });
    const insertedLines = await repo.insertPartRequestLines(client, header.id, lines);
    return { ...header, lines: insertedLines };
  });
}

export async function updatePartRequest(pool, id, body, authStaff) {
  const companyId  = requireCompanyId(authStaff);
  const branchId   = requireBranchId(authStaff, body);
  const modifiedBy = actorLabel(authStaff);
  const lines      = buildLines(body.lines);

  return withTransaction(async (client) => {
    const existing = await repo.findPartRequestById(pool, companyId, branchId, Number(id));
    if (!existing) { const err = new Error('Part request not found'); err.status = 404; throw err; }
    if (existing.status !== 'PENDING') {
      const err = new Error('Only PENDING requests can be edited'); err.status = 409; throw err;
    }
    const header = await repo.updatePartRequest(client, companyId, branchId, Number(id), {
      jobCardId:   toIntOrNull(body.jobCardId),
      jcNo:        trimOrNull(body.jcNo, 30),
      requestDate: toDateOrNull(body.requestDate) ?? new Date().toISOString().slice(0, 10),
      expectedDeliveryDate: toDateOrNull(body.expectedDeliveryDate),
      requestedBy: trimOrNull(body.requestedBy, 100),
      technicianId: toIntOrNull(body.technicianId),
      workshopId:   toIntOrNull(body.workshopId),
      internalInvoiceNo: toIntOrNull(body.internalInvoiceNo),
      remarks:     trimOrNull(body.remarks, 2000),
      modifiedBy,
    });
    const updatedLines = await repo.replacePartRequestLines(client, Number(id), lines);
    return { ...header, lines: updatedLines };
  });
}

export async function issuePartRequest(pool, id, body, authStaff) {
  const companyId  = requireCompanyId(authStaff);
  const branchId   = requireBranchId(authStaff, {});
  const modifiedBy = actorLabel(authStaff);

  const lineUpdates = Array.isArray(body.lines)
    ? body.lines.map((l) => ({ id: Number(l.id), qtyIssued: toNonNeg(l.qtyIssued) }))
    : [];

  if (lineUpdates.length === 0) {
    const err = new Error('No lines provided for issuance'); err.status = 400; throw err;
  }

  const existing = await repo.findPartRequestById(pool, companyId, branchId, Number(id));
  if (!existing) { const err = new Error('Part request not found'); err.status = 404; throw err; }
  if (existing.status === 'FULLY_ISSUED' || existing.status === 'CANCELLED') {
    const err = new Error(`Cannot issue a ${existing.status} request`); err.status = 409; throw err;
  }

  return withTransaction(async (client) => {
    return repo.issuePartRequestLines(client, pool, Number(id), companyId, branchId, lineUpdates, modifiedBy);
  });
}

export async function cancelPartRequest(pool, id, authStaff) {
  const companyId  = requireCompanyId(authStaff);
  const branchId   = requireBranchId(authStaff, {});
  const modifiedBy = actorLabel(authStaff);

  const existing = await repo.findPartRequestById(pool, companyId, branchId, Number(id));
  if (!existing) { const err = new Error('Part request not found'); err.status = 404; throw err; }
  if (existing.status === 'FULLY_ISSUED') {
    const err = new Error('Cannot cancel a fully issued request'); err.status = 409; throw err;
  }

  const updated = await repo.cancelPartRequest(pool, companyId, branchId, Number(id), modifiedBy);
  return updated;
}
