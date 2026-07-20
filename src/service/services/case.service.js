import { withTransaction } from '../../config/db.js';
import * as caseRepo from '../repositories/case.repository.js';
import * as serviceRepo from '../repositories/service.repository.js';
import { nextDocNo } from '../../shared/services/docSequence.service.js';
import {
  trimOrNull, toIntOrNull, toNumberOrNull,
  requireCompanyId, requireBranchId, actorStaffId,
} from '../../utils/crmHelpers.js';

const CASE_STATUSES = ['NEW', 'IN_PROGRESS', 'WAITING_APPROVAL', 'ON_HOLD', 'READY_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'];
const TASK_STATUSES = ['PENDING', 'IN_PROGRESS', 'WAITING_APPROVAL', 'DONE'];
const DOCUMENT_STATUSES = ['PENDING', 'RECEIVED', 'RETURNED', 'EXPIRED'];
const PAYMENT_TYPES = ['GOVERNMENT_FEE', 'SERVICE_CHARGE', 'ADVANCE_PAYMENT', 'BALANCE_PAYMENT'];
const PAYMENT_METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'PAYMENT_LINK'];

function assertOneOf(value, allowed, label) {
  if (!allowed.includes(value)) {
    const e = new Error(`Invalid ${label}: ${value}`); e.status = 400; throw e;
  }
}

async function withBalance(pool, kase) {
  const paid = await caseRepo.sumPaidForCase(pool, kase.id);
  return { ...kase, paid, balance: Math.max(0, Number(kase.quotedTotal) - paid) };
}

// ── Case CRUD ────────────────────────────────────────────────────────────

export async function list(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const filters = {
    status: trimOrNull(query.status, 30),
    assignedStaffId: toIntOrNull(query.assignedStaffId ?? query.assigneeStaffId),
    customerId: toIntOrNull(query.customerId),
    search: trimOrNull(query.search, 30),
  };
  const rows = await caseRepo.listByCompany(pool, companyId, filters);
  return Promise.all(rows.map((r) => withBalance(pool, r)));
}

export async function getById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const row = await caseRepo.findById(pool, companyId, Number(id));
  if (!row) { const e = new Error('Case not found'); e.status = 404; throw e; }
  const [tasks, documents, payments, statusHistory, withBal] = await Promise.all([
    caseRepo.listTasksByCase(pool, row.id),
    caseRepo.listDocumentsByCase(pool, row.id),
    caseRepo.listPaymentsByCase(pool, row.id),
    caseRepo.getStatusHistory(pool, row.id),
    withBalance(pool, row),
  ]);
  return { ...withBal, tasks, documents, payments, statusHistory };
}

export async function create(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const customerId = toIntOrNull(body.customerId ?? body.customer_id);
  const serviceId = toIntOrNull(body.serviceId ?? body.service_id);
  if (!customerId) { const e = new Error('customerId is required'); e.status = 400; throw e; }
  if (!serviceId) { const e = new Error('serviceId is required'); e.status = 400; throw e; }

  const priority = trimOrNull(body.priority, 20) || 'NORMAL';
  const assignedStaffId = toIntOrNull(body.assignedStaffId ?? body.assigned_staff_id);
  const notes = trimOrNull(body.notes, 4000);
  const actor = actorStaffId(authStaff);

  return withTransaction(async (client) => {
    const service = await serviceRepo.findById(client, companyId, serviceId);
    if (!service) { const e = new Error('Service not found'); e.status = 404; throw e; }
    if (!(await caseRepo.customerExists(client, companyId, customerId))) {
      const e = new Error('Customer not found'); e.status = 404; throw e;
    }
    const { taskTemplates, documentRequirements } = await serviceRepo.getChildren(client, serviceId);

    const dueDate = trimOrNull(body.dueDate ?? body.due_date, 10)
      || new Date(Date.now() + (service.expectedDays || 1) * 86400000).toISOString().slice(0, 10);

    const vatAmount = Number((service.serviceCharge * (service.vatPercent / 100)).toFixed(2));
    const quotedTotal = Number((service.governmentFee + service.serviceCharge + vatAmount).toFixed(2));

    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [`service.case_master:${companyId}`]);
    const caseId = await caseRepo.nextCaseId(client, companyId);
    const caseCode = await nextDocNo(client, { companyId, branchId, sequenceCode: 'CASE' });

    const kase = await caseRepo.insert(client, {
      companyId, branchId, caseId, caseCode, customerId, serviceId,
      priority, assignedStaffId, dueDate,
      governmentFee: service.governmentFee, serviceCharge: service.serviceCharge,
      vatPercent: service.vatPercent, vatAmount, quotedTotal, notes,
      actorStaffId: actor,
    });

    await caseRepo.insertStatusHistory(client, { companyId, caseId: kase.id, fromStatus: null, toStatus: 'NEW', changedBy: actor, remarks: 'Case created' });

    const taskSeed = (Array.isArray(body.tasks) && body.tasks.length ? body.tasks : taskTemplates)
      .map((t) => ({ taskName: t.taskName, assigneeStaffId: t.defaultAssigneeStaffId ?? assignedStaffId, dueDate: null }));
    const tasks = await caseRepo.insertTasks(client, companyId, kase.id, taskSeed);

    const docSeed = Array.isArray(body.documents) && body.documents.length
      ? body.documents.map((d) => ({ documentName: d.documentName ?? d.name, status: d.status || 'PENDING', expiryDate: d.expiryDate ?? null }))
      : documentRequirements.map((d) => ({ documentName: d.documentName, status: 'PENDING', expiryDate: null }));
    const documents = await caseRepo.insertDocuments(client, companyId, kase.id, docSeed);

    let payments = [];
    if (Array.isArray(body.payments) && body.payments.length) {
      for (const p of body.payments) {
        const paymentType = trimOrNull(p.paymentType ?? p.kind, 40);
        const amount = toNumberOrNull(p.amount);
        const paymentMethod = trimOrNull(p.paymentMethod ?? p.method, 30);
        if (!amount || amount <= 0) continue;
        assertOneOf(paymentType, PAYMENT_TYPES, 'paymentType');
        assertOneOf(paymentMethod, PAYMENT_METHODS, 'paymentMethod');
        const row = await caseRepo.addPayment(client, {
          companyId, branchId, caseId: kase.id, paymentType, amount, paymentMethod,
          paidBy: trimOrNull(p.paidBy, 200), paymentDate: trimOrNull(p.paymentDate ?? p.date, 10),
          reference: trimOrNull(p.reference, 100), remarks: trimOrNull(p.remarks, 500), actorStaffId: actor,
        });
        payments.push(row);
      }
    }

    return { ...kase, tasks, documents, payments, statusHistory: [] };
  });
}

export async function updateFields(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const updated = await caseRepo.updateFields(pool, companyId, Number(id), {
    priority: trimOrNull(body.priority, 20),
    assignedStaffId: toIntOrNull(body.assignedStaffId ?? body.assigned_staff_id),
    dueDate: trimOrNull(body.dueDate ?? body.due_date, 10),
    notes: body.notes !== undefined ? trimOrNull(body.notes, 4000) : null,
    actorStaffId: actorStaffId(authStaff),
  });
  if (!updated) { const e = new Error('Case not found'); e.status = 404; throw e; }
  return withBalance(pool, updated);
}

export async function updateStatus(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const status = trimOrNull(body.status, 30);
  assertOneOf(status, CASE_STATUSES, 'status');
  const actor = actorStaffId(authStaff);

  return withTransaction(async (client) => {
    const existing = await caseRepo.findById(client, companyId, Number(id));
    if (!existing) { const e = new Error('Case not found'); e.status = 404; throw e; }
    const updated = await caseRepo.updateStatus(client, companyId, Number(id), { status, actorStaffId: actor });
    await caseRepo.insertStatusHistory(client, {
      companyId, caseId: updated.id, fromStatus: existing.status, toStatus: status,
      changedBy: actor, remarks: trimOrNull(body.remarks, 300),
    });
    return withBalance(client, updated);
  });
}

// ── Tasks ────────────────────────────────────────────────────────────────

export async function listTaskBoard(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  return caseRepo.listTasksByCompany(pool, companyId, { assigneeStaffId: toIntOrNull(query.assigneeStaffId) });
}

export async function updateTask(pool, caseId, taskId, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const status = body.status !== undefined ? trimOrNull(body.status, 30) : undefined;
  if (status) assertOneOf(status, TASK_STATUSES, 'status');
  const updated = await caseRepo.updateTask(pool, companyId, Number(caseId), Number(taskId), {
    status: status ?? null,
    assigneeStaffId: toIntOrNull(body.assigneeStaffId ?? body.assignee_staff_id),
    dueDate: trimOrNull(body.dueDate ?? body.due_date, 10),
    notes: body.notes !== undefined ? trimOrNull(body.notes, 4000) : null,
  });
  if (!updated) { const e = new Error('Task not found'); e.status = 404; throw e; }
  return updated;
}

// ── Documents ────────────────────────────────────────────────────────────

export async function listAllDocuments(pool, authStaff) {
  const companyId = requireCompanyId(authStaff);
  return caseRepo.listAllDocuments(pool, companyId);
}

export async function addDocument(pool, caseId, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const documentName = trimOrNull(body.documentName ?? body.name, 150);
  if (!documentName) { const e = new Error('documentName is required'); e.status = 400; throw e; }
  const status = trimOrNull(body.status, 30) || 'PENDING';
  assertOneOf(status, DOCUMENT_STATUSES, 'status');
  return caseRepo.addDocument(pool, companyId, Number(caseId), {
    documentName, status, expiryDate: trimOrNull(body.expiryDate ?? body.expiry_date, 10),
  });
}

export async function updateDocument(pool, caseId, documentId, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const status = body.status !== undefined ? trimOrNull(body.status, 30) : undefined;
  if (status) assertOneOf(status, DOCUMENT_STATUSES, 'status');
  const updated = await caseRepo.updateDocument(pool, companyId, Number(caseId), Number(documentId), {
    status: status ?? null,
    expiryDate: body.expiryDate !== undefined || body.expiry_date !== undefined
      ? trimOrNull(body.expiryDate ?? body.expiry_date, 10) : undefined,
    fileName: trimOrNull(body.fileName ?? body.file_name, 255),
    filePath: trimOrNull(body.filePath ?? body.file_path, 500),
  });
  if (!updated) { const e = new Error('Document not found'); e.status = 404; throw e; }
  return updated;
}

// ── Payments ─────────────────────────────────────────────────────────────

export async function listAllPayments(pool, authStaff) {
  const companyId = requireCompanyId(authStaff);
  return caseRepo.listPaymentsByCompany(pool, companyId);
}

export async function addPayment(pool, caseId, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const paymentType = trimOrNull(body.paymentType ?? body.kind, 40);
  const paymentMethod = trimOrNull(body.paymentMethod ?? body.method, 30);
  const amount = toNumberOrNull(body.amount);
  assertOneOf(paymentType, PAYMENT_TYPES, 'paymentType');
  assertOneOf(paymentMethod, PAYMENT_METHODS, 'paymentMethod');
  if (!amount || amount <= 0) { const e = new Error('amount must be greater than 0'); e.status = 400; throw e; }

  return withTransaction(async (client) => {
    const kase = await caseRepo.findById(client, companyId, Number(caseId));
    if (!kase) { const e = new Error('Case not found'); e.status = 404; throw e; }
    return caseRepo.addPayment(client, {
      companyId, branchId: kase.branchId ?? branchId, caseId: kase.id, paymentType, amount, paymentMethod,
      paidBy: trimOrNull(body.paidBy, 200), paymentDate: trimOrNull(body.paymentDate ?? body.date, 10),
      reference: trimOrNull(body.reference, 100), remarks: trimOrNull(body.remarks, 500),
      actorStaffId: actorStaffId(authStaff),
    });
  });
}

export { CASE_STATUSES, TASK_STATUSES, DOCUMENT_STATUSES, PAYMENT_TYPES, PAYMENT_METHODS };
