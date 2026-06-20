import { withTransaction } from '../../config/db.js';
import {
  requireBranchId,
  requireCompanyId,
  toIntOrNull,
  toNumberOrNull,
  trimOrNull,
} from '../../utils/crmHelpers.js';
import * as repo from '../repositories/jobCard.repository.js';
import { linkPreJcToJobCard } from '../repositories/preJobCard.repository.js';
import * as technicianRepo from '../repositories/technician.repository.js';
import { nextDocNo } from '../../shared/services/docSequence.service.js';

const VALID_CUSTOMER_TYPES = ['CASH', 'CREDIT', 'INSURANCE', 'CORPORATE', 'WARRANTY'];
const VALID_JOB_TYPES = ['BODYSHOP', 'MECHANICAL', 'ELECTRICAL', 'GENERAL SERVICE', 'AC SERVICE', 'TYRES', 'OTHER'];
const TECH_WORK_STATUSES = ['INSPECTION_ASSIGNED', 'INSPECTION_IN_PROGRESS', 'CUSTOMER_APPROVED', 'PARTS_ISSUED', 'WORK_READY', 'WORK_IN_PROGRESS'];

function toDateOrNull(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

function toBool(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function toNonNeg(v) {
  const n = toNumberOrNull(v);
  return n == null || n < 0 ? 0 : n;
}

function buildHeaderPayload(body) {
  return {
    regNo: trimOrNull(body.regNo, 30),
    chassisNo: trimOrNull(body.chassisNo, 50),
    stationCode: trimOrNull(body.stationCode, 50),
    customerType: VALID_CUSTOMER_TYPES.includes(body.customerType) ? body.customerType : null,
    vehOwnerName: trimOrNull(body.vehOwnerName, 150),
    customerName: trimOrNull(body.customerName, 150),
    jobBroughtBy: trimOrNull(body.jobBroughtBy, 50),
    driver: trimOrNull(body.driver, 100),
    serviceAdvisor: trimOrNull(body.serviceAdvisor, 100),
    bookingDate: toDateOrNull(body.bookingDate) ?? new Date().toISOString().slice(0, 10),
    promiseDate: toDateOrNull(body.promiseDate),
    kmReadingIn: toNonNeg(body.kmReading),
    jobType: VALID_JOB_TYPES.includes(body.jobType) ? body.jobType : null,
    estimationNo: trimOrNull(body.estimationNo, 50),
    estimationAmount: toNonNeg(body.estimationAmount),
    lpoNo: trimOrNull(body.lpoNo, 50),
    lpoDate: toDateOrNull(body.lpoDate),
    claimNo: trimOrNull(body.claimNo, 50),
    excessAmt: toNonNeg(body.excessAmt),
    advanceReceived: toNonNeg(body.advanceReceived),
    invoiceParty: trimOrNull(body.invoiceParty, 150),
    customerConcern: trimOrNull(body.customerConcern, 5000),
    shortDesc: trimOrNull(body.shortDesc, 2000),
    repeatJob: toBool(body.repeatJob),
    jobRefNo: trimOrNull(body.jobRefNo, 50),
    policeRefNo: trimOrNull(body.policeRefNo, 50),
    policeReport: toBool(body.policeReport),
    warrantyRepair: toBool(body.warrantyRepair),
    totalLoss: toBool(body.totalLoss),
    qcPass: toBool(body.qcPass),
    qcDetails: trimOrNull(body.qcDetails, 2000),
    warrantyDetails: trimOrNull(body.warrantyDetails, 2000),
    preJcId: body.preJcId == null ? null : Number(body.preJcId),
    vehicleId: toIntOrNull(body.vehicleId),
    estimationId: toIntOrNull(body.estimationId),
    customerId: toIntOrNull(body.customerId),
  };
}

function buildLines(rawLines) {
  if (!Array.isArray(rawLines)) return [];
  return rawLines.map((l) => ({
    jobCode: trimOrNull(l.jobCode, 20),
    description: trimOrNull(l.description, 500),
    stdTime: toNonNeg(l.stdTime),
    unitCost: toNonNeg(l.cost ?? l.unitCost),
    sellingPrice: toNonNeg(l.price ?? l.sellingPrice),
  }));
}

function actorLabel(authStaff) {
  return trimOrNull(authStaff?.staff_name, 50) || trimOrNull(authStaff?.login_name, 50) || 'system';
}

function actorStaffId(authStaff) {
  const n = Number(authStaff?.staff_id);
  return Number.isFinite(n) ? n : null;
}

function identityText(authStaff) {
  return [
    authStaff?.login_name,
    authStaff?.email,
    authStaff?.staff_name,
    authStaff?.role_name,
    authStaff?.designation,
  ].filter(Boolean).join(' ').toLowerCase();
}

export function garageRole(authStaff) {
  const text = identityText(authStaff);
  if (text.includes('t_garage_backoffice') || text.includes('admin') || text.includes('main')) return 'admin';
  if (text.includes('advisor')) return 'advisor';
  if (text.includes('supervisor')) return 'supervisor';
  if (text.includes('store') || text.includes('keeper') || text.includes('sonu')) return 'store';
  if (text.includes('mechanic') || text.includes('technician') || text.includes('hisham') || text.includes('sabeeh')) return 'technician';
  return 'admin';
}

function parseStatuses(value) {
  if (!value) return [];
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

async function currentTechnicianId(pool, companyId, branchId, authStaff) {
  const candidates = [
    authStaff?.staff_code,
    authStaff?.login_name,
    authStaff?.email,
    authStaff?.staff_name,
  ].map((v) => String(v || '').trim()).filter(Boolean);
  for (const search of candidates) {
    const techs = await technicianRepo.listTechnicians(pool, companyId, branchId, search);
    const exact = techs.find((t) =>
      String(t.empId || '').toLowerCase() === search.toLowerCase()
      || String(t.techName || '').toLowerCase() === search.toLowerCase()
    );
    if (exact) return exact.id;
    if (techs.length === 1) return techs[0].id;
  }
  return null;
}

export async function listJobCards(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, query);
  const role = garageRole(authStaff);
  const filters = {
    workflowStatus: trimOrNull(query.workflowStatus, 40) || trimOrNull(query.status, 40),
    workflowStatuses: parseStatuses(query.workflowStatuses),
  };
  if (query.roleQueue === '1' || query.roleQueue === 'true') {
    if (role === 'advisor') {
      filters.workflowStatuses = ['OPEN_BY_ADVISOR', 'WAITING_CUSTOMER_APPROVAL', 'CUSTOMER_REJECTED'];
    } else if (role === 'supervisor') {
      filters.workflowStatuses = ['SENT_TO_WORKSHOP', 'INSPECTION_ASSIGNED', 'INSPECTION_COMPLETED', 'SUPERVISOR_REVIEW', 'CUSTOMER_APPROVED', 'PARTS_REQUESTED', 'PARTS_ISSUED', 'WORK_READY', 'WORK_IN_PROGRESS'];
    } else if (role === 'technician') {
      filters.workflowStatuses = TECH_WORK_STATUSES;
      filters.assignedTechnicianId = await currentTechnicianId(pool, companyId, branchId, authStaff);
    }
  }
  return repo.listJobCards(pool, companyId, branchId, trimOrNull(query.q, 120), filters);
}

export async function getJobCardById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const jc = await repo.findJobCardById(pool, companyId, branchId, Number(id));
  if (!jc) {
    const err = new Error('Job card not found'); err.status = 404; throw err;
  }
  return jc;
}

export async function createJobCard(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const payload = buildHeaderPayload(body);
  const lines = buildLines(body.lines);
  const createdBy = actorLabel(authStaff);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `garage.job_card:${companyId}:${branchId}`,
    ]);
    const jcNo = await nextDocNo(client, { companyId, branchId, sequenceCode: 'JOB_CARD', fiscalYear: new Date().getFullYear() });
    const header = await repo.insertJobCard(client, {
      companyId, branchId, jcNo, ...payload, createdBy,
    });
    const insertedLines = await repo.insertJobCardLines(client, header.id, companyId, lines);

    if (payload.preJcId) {
      await linkPreJcToJobCard(client, companyId, branchId, payload.preJcId, header.id);
    }

    return { ...header, lines: insertedLines };
  });
}

export async function transitionJobCard(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const jobCardId = Number(id);
  const action = String(body?.action || '').trim();
  const now = new Date().toISOString();
  const actor = { staffId: actorStaffId(authStaff), name: actorLabel(authStaff) };

  const patch = { action, remarks: trimOrNull(body?.remarks, 2000) };
  if (action === 'send_to_workshop') {
    patch.workflowStatus = 'SENT_TO_WORKSHOP';
  } else if (action === 'assign_technician') {
    const techId = toIntOrNull(body.technicianId);
    if (!techId) {
      const err = new Error('technicianId is required'); err.status = 400; throw err;
    }
    const tech = await technicianRepo.findTechnicianById(pool, companyId, branchId, techId);
    if (!tech) {
      const err = new Error('Technician not found'); err.status = 404; throw err;
    }
    patch.workflowStatus = 'INSPECTION_ASSIGNED';
    patch.assignedSupervisorId = actor.staffId;
    patch.assignedSupervisorName = actor.name;
    patch.assignedTechnicianId = tech.id;
    patch.assignedTechnicianName = tech.techName;
  } else if (action === 'start_inspection') {
    patch.workflowStatus = 'INSPECTION_IN_PROGRESS';
    patch.inspectionStartedAt = now;
  } else if (action === 'complete_inspection') {
    patch.workflowStatus = 'INSPECTION_COMPLETED';
    patch.inspectionCompletedAt = now;
    patch.inspectionNotes = trimOrNull(body.inspectionNotes, 5000);
    patch.suggestedJobs = trimOrNull(body.suggestedJobs, 5000);
  } else if (action === 'send_to_advisor') {
    patch.workflowStatus = 'WAITING_CUSTOMER_APPROVAL';
    patch.supervisorReviewNotes = trimOrNull(body.supervisorReviewNotes, 5000);
    patch.suggestedJobs = trimOrNull(body.suggestedJobs, 5000);
  } else if (action === 'customer_approval') {
    const approved = body.approved === true || body.approved === 'true';
    patch.workflowStatus = approved ? 'CUSTOMER_APPROVED' : 'CUSTOMER_REJECTED';
    patch.customerApprovalStatus = approved ? 'APPROVED' : 'REJECTED';
    patch.customerApprovalNotes = trimOrNull(body.customerApprovalNotes, 5000);
    patch.customerApprovedAt = approved ? now : null;
  } else if (action === 'parts_requested') {
    patch.workflowStatus = 'PARTS_REQUESTED';
  } else if (action === 'parts_issued') {
    patch.workflowStatus = 'PARTS_ISSUED';
  } else if (action === 'mark_work_ready') {
    patch.workflowStatus = 'WORK_READY';
  } else if (action === 'start_work') {
    patch.workflowStatus = 'WORK_IN_PROGRESS';
    patch.workStartedAt = now;
  } else if (action === 'complete_work') {
    patch.workflowStatus = 'WORK_COMPLETED';
    patch.workCompletedAt = now;
  } else if (action === 'ready_for_delivery') {
    patch.workflowStatus = 'READY_FOR_DELIVERY';
  } else {
    const err = new Error('Unknown workflow action'); err.status = 400; throw err;
  }

  return withTransaction(async (client) => {
    const updated = await repo.transitionWorkflow(client, companyId, branchId, jobCardId, patch, actor);
    if (!updated) {
      const err = new Error('Job card not found'); err.status = 404; throw err;
    }
    return updated;
  });
}

export async function updateJobCard(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const payload = buildHeaderPayload(body);
  const lines = buildLines(body.lines);
  const modifiedBy = actorLabel(authStaff);

  return withTransaction(async (client) => {
    const header = await repo.updateJobCard(client, companyId, branchId, Number(id), {
      ...payload, modifiedBy,
    });
    if (!header) {
      const err = new Error('Job card not found'); err.status = 404; throw err;
    }
    const updatedLines = await repo.replaceJobCardLines(client, header.id, companyId, lines);
    return { ...header, lines: updatedLines };
  });
}

export async function postJobCard(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const modifiedBy = actorLabel(authStaff);
  const jc = await repo.findJobCardById(pool, companyId, branchId, Number(id));
  if (!jc) {
    const err = new Error('Job card not found'); err.status = 404; throw err;
  }
  if (jc.status === 'POSTED') {
    const err = new Error('Job card is already posted'); err.status = 409; throw err;
  }
  const updated = await repo.setJobCardStatus(pool, companyId, branchId, Number(id), 'POSTED', modifiedBy);
  return updated;
}

export async function unpostJobCard(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const modifiedBy = actorLabel(authStaff);
  const jc = await repo.findJobCardById(pool, companyId, branchId, Number(id));
  if (!jc) {
    const err = new Error('Job card not found'); err.status = 404; throw err;
  }
  if (jc.status !== 'POSTED') {
    const err = new Error('Job card is not posted'); err.status = 409; throw err;
  }
  const updated = await repo.setJobCardStatus(pool, companyId, branchId, Number(id), 'OPEN', modifiedBy);
  return updated;
}

export async function deliverVehicle(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const modifiedBy = actorLabel(authStaff);
  const jc = await repo.findJobCardById(pool, companyId, branchId, Number(id));
  if (!jc) {
    const err = new Error('Job card not found'); err.status = 404; throw err;
  }
  if (jc.status === 'CLOSED') {
    const err = new Error('Job card already closed'); err.status = 409; throw err;
  }
  const deliveryDate = toDateOrNull(body.deliveryDate) ?? new Date().toISOString().slice(0, 10);
  const kmReadingOut = body.kmReadingOut != null ? Math.max(0, Number(body.kmReadingOut)) : null;
  const invoiceId = body.invoiceId != null ? Number(body.invoiceId) : null;
  const updated = await repo.deliverVehicle(pool, companyId, branchId, Number(id), {
    deliveryDate, kmReadingOut, invoiceId, modifiedBy,
  });
  return updated;
}

export async function workshopMonitor(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, query);
  return repo.workshopMonitor(pool, companyId, branchId, trimOrNull(query.status, 20));
}
