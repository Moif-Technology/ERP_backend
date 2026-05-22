import { withTransaction } from '../config/db.js';
import * as repo from '../repositories/crmInteraction.repository.js';
import {
  requiredStr, trimOrNull, toIntOrNull,
  requireCompanyId, requireBranchId, actorStaffId,
} from '../utils/crmHelpers.js';

const VALID_TYPE = new Set(['CALL', 'MEETING', 'VISIT', 'EMAIL', 'WHATSAPP', 'SMS', 'DEMO', 'PROPOSAL', 'NOTE']);
const VALID_MODE = new Set(['PHONE', 'INPERSON', 'ONLINE', 'EMAIL', 'INBOUND', 'OUTBOUND']);

function toPositiveIntOrNull(v) {
  const n = toIntOrNull(v);
  return n != null && n > 0 ? n : null;
}

function toDateOrNull(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function normType(v) {
  const s = String(v || '').trim().toUpperCase() || 'CALL';
  return VALID_TYPE.has(s) ? s : 'CALL';
}

function normMode(v) {
  const raw = String(v || '').trim().toUpperCase() || 'PHONE';
  const normalized = raw === 'IN-PERSON' ? 'INPERSON' : raw;
  return VALID_MODE.has(normalized) ? normalized : 'PHONE';
}

function buildPayload(body) {
  return {
    customerId: toPositiveIntOrNull(body.customerId ?? body.customer_id),
    leadId: toPositiveIntOrNull(body.leadId ?? body.lead_id),
    opportunityId: toPositiveIntOrNull(body.opportunityId ?? body.opportunity_id),
    interactionDate: toDateOrNull(body.interactionDate ?? body.interaction_date),
    interactionType: normType(body.interactionType ?? body.interaction_type),
    interactionMode: normMode(body.interactionMode ?? body.interaction_mode),
    subject: requiredStr(body.subject, 'subject', 200),
    interactionSummary: trimOrNull(body.interactionSummary ?? body.interaction_summary, 4000),
    outcome: trimOrNull(body.outcome, 100),
    nextActionAt: toDateOrNull(body.nextActionAt ?? body.next_action_at),
    staffId: toPositiveIntOrNull(body.staffId ?? body.staff_id ?? body.assignedToStaffId),
  };
}

function validateLinkTarget(payload) {
  if (payload.customerId == null && payload.leadId == null && payload.opportunityId == null) {
    const e = new Error('customerId, leadId, or opportunityId is required');
    e.status = 400;
    throw e;
  }
}

async function resolveOpportunityLink(pool, companyId, opportunityId) {
  if (opportunityId == null) return null;
  const { rows } = await pool.query(
    `SELECT customer_id, lead_id
       FROM biz.opportunity_master
      WHERE company_id = $1 AND opportunity_id = $2
      LIMIT 1`,
    [companyId, opportunityId]
  );
  return rows[0] || null;
}

export async function list(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const opportunityId = toIntOrNull(query.opportunityId);
  const opportunityLink = await resolveOpportunityLink(pool, companyId, opportunityId);
  return repo.listByCompany(pool, companyId, {
    search: trimOrNull(query.search, 100),
    interactionType: trimOrNull(query.interactionType, 30)?.toUpperCase() || null,
    interactionMode: trimOrNull(query.interactionMode, 30)?.toUpperCase() || null,
    staffId: toIntOrNull(query.staffId ?? query.assignedTo),
    customerId: toIntOrNull(query.customerId),
    leadId: toIntOrNull(query.leadId),
    linkAny: opportunityLink ? [{ customerId: opportunityLink.customer_id != null ? Number(opportunityLink.customer_id) : null, leadId: opportunityLink.lead_id != null ? Number(opportunityLink.lead_id) : null }] : null,
    from: toDateOrNull(query.from),
    to: toDateOrNull(query.to),
  });
}

export async function getById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const row = await repo.findById(pool, companyId, Number(id));
  if (!row) {
    const e = new Error('Interaction not found');
    e.status = 404;
    throw e;
  }
  return row;
}

export async function create(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const payload = buildPayload(body);
  const opportunityLink = await resolveOpportunityLink(pool, companyId, payload.opportunityId);
  if (opportunityLink) {
    if (payload.customerId == null && opportunityLink.customer_id != null) payload.customerId = Number(opportunityLink.customer_id);
    if (payload.leadId == null && opportunityLink.lead_id != null) payload.leadId = Number(opportunityLink.lead_id);
  }
  validateLinkTarget(payload);
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [`biz.customer_interaction_log:${companyId}`]);
    const interactionId = await repo.nextInteractionId(client, companyId);
    return repo.insert(client, {
      ...payload,
      companyId,
      branchId,
      interactionId,
      actorStaffId: actorStaffId(authStaff),
    });
  });
}

export async function update(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const payload = buildPayload(body);
  const opportunityLink = await resolveOpportunityLink(pool, companyId, payload.opportunityId);
  if (opportunityLink) {
    if (payload.customerId == null && opportunityLink.customer_id != null) payload.customerId = Number(opportunityLink.customer_id);
    if (payload.leadId == null && opportunityLink.lead_id != null) payload.leadId = Number(opportunityLink.lead_id);
  }
  validateLinkTarget(payload);
  const row = await repo.update(pool, companyId, Number(id), {
    ...payload,
    actorStaffId: actorStaffId(authStaff),
  });
  if (!row) {
    const e = new Error('Interaction not found');
    e.status = 404;
    throw e;
  }
  return row;
}

export async function remove(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const ok = await repo.softDelete(pool, companyId, Number(id), actorStaffId(authStaff));
  if (!ok) {
    const e = new Error('Interaction not found');
    e.status = 404;
    throw e;
  }
  return { ok: true };
}
