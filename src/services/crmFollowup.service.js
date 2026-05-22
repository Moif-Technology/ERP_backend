import { withTransaction } from '../config/db.js';
import * as repo from '../repositories/crmFollowup.repository.js';
import {
  requiredStr, trimOrNull, toBool, toIntOrNull,
  requireCompanyId, requireBranchId, actorStaffId,
} from '../utils/crmHelpers.js';

const VALID_PRIORITY = new Set(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const VALID_STATUS = new Set(['PENDING', 'COMPLETED', 'CANCELLED']);
const VALID_TYPE = new Set(['CALL', 'EMAIL', 'MEETING', 'VISIT', 'TASK', 'WHATSAPP', 'SMS', 'DEMO']);

function toDateOrNull(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function normPriority(v) {
  const s = String(v || '').trim().toUpperCase() || 'MEDIUM';
  return VALID_PRIORITY.has(s) ? s : 'MEDIUM';
}

function normStatus(v) {
  const s = String(v || '').trim().toUpperCase() || 'PENDING';
  return VALID_STATUS.has(s) ? s : 'PENDING';
}

function normType(v) {
  const s = String(v || '').trim().toUpperCase() || 'CALL';
  return VALID_TYPE.has(s) ? s : 'CALL';
}

function buildPayload(body) {
  return {
    customerId: toIntOrNull(body.customerId ?? body.customer_id),
    leadId: toIntOrNull(body.leadId ?? body.lead_id),
    opportunityId: toIntOrNull(body.opportunityId ?? body.opportunity_id),
    followupDate: toDateOrNull(body.followupDate ?? body.followup_date),
    followupType: normType(body.followupType ?? body.followup_type),
    subject: requiredStr(body.subject, 'subject', 200),
    priority: normPriority(body.priority),
    status: normStatus(body.status),
    assignedToStaffId: toIntOrNull(body.assignedToStaffId ?? body.assigned_to_staff_id),
    notes: trimOrNull(body.notes, 4000),
    completionNotes: trimOrNull(body.completionNotes ?? body.completion_notes, 4000),
  };
}

function validateLinkTarget(payload) {
  if (payload.customerId == null && payload.leadId == null && payload.opportunityId == null) {
    const e = new Error('customerId, leadId, or opportunityId is required');
    e.status = 400;
    throw e;
  }
  if (!payload.followupDate) {
    const e = new Error('followupDate is required');
    e.status = 400;
    throw e;
  }
}

export async function list(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  return repo.listByCompany(pool, companyId, {
    search: trimOrNull(query.search, 100),
    status: trimOrNull(query.status, 20)?.toUpperCase() || null,
    priority: trimOrNull(query.priority, 20)?.toUpperCase() || null,
    followupType: trimOrNull(query.followupType, 30)?.toUpperCase() || null,
    assignedTo: toIntOrNull(query.assignedTo),
    customerId: toIntOrNull(query.customerId),
    leadId: toIntOrNull(query.leadId),
    opportunityId: toIntOrNull(query.opportunityId),
    from: toDateOrNull(query.from),
    to: toDateOrNull(query.to),
    overdue: toBool(query.overdue, false),
    today: toBool(query.today, false),
  });
}

export async function getById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const row = await repo.findById(pool, companyId, Number(id));
  if (!row) {
    const e = new Error('Follow-up not found');
    e.status = 404;
    throw e;
  }
  return row;
}

export async function create(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const payload = buildPayload(body);
  validateLinkTarget(payload);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [`biz.customer_followup:${companyId}`]);
    const followupId = await repo.nextFollowupId(client, companyId);
    return repo.insert(client, {
      ...payload,
      companyId,
      branchId,
      followupId,
      actorStaffId: actorStaffId(authStaff),
    });
  });
}

export async function update(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const payload = buildPayload(body);
  validateLinkTarget(payload);
  const row = await repo.update(pool, companyId, Number(id), {
    ...payload,
    actorStaffId: actorStaffId(authStaff),
  });
  if (!row) {
    const e = new Error('Follow-up not found');
    e.status = 404;
    throw e;
  }
  return row;
}

export async function complete(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const row = await repo.markCompleted(
    pool,
    companyId,
    Number(id),
    trimOrNull(body.completionNotes ?? body.completion_notes, 4000),
    actorStaffId(authStaff)
  );
  if (!row) {
    const e = new Error('Follow-up not found');
    e.status = 404;
    throw e;
  }
  return row;
}

export async function remove(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const ok = await repo.softDelete(pool, companyId, Number(id), actorStaffId(authStaff));
  if (!ok) {
    const e = new Error('Follow-up not found');
    e.status = 404;
    throw e;
  }
  return { ok: true };
}
