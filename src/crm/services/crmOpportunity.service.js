import { withTransaction } from '../../config/db.js';
import * as repo from '../repositories/crmOpportunity.repository.js';
import {
  requiredStr, trimOrNull, toIntOrNull, toNumberOrNull,
  requireCompanyId, requireBranchId, actorStaffId,
} from '../../utils/crmHelpers.js';

const VALID_PRIORITY = new Set(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const VALID_STATUS = new Set(['OPEN', 'WON', 'LOST', 'CANCELLED']);

function normPriority(v) {
  const s = String(v || '').trim().toUpperCase() || 'MEDIUM';
  return VALID_PRIORITY.has(s) ? s : 'MEDIUM';
}

function normStatus(v) {
  const s = String(v || '').trim().toUpperCase() || 'OPEN';
  return VALID_STATUS.has(s) ? s : 'OPEN';
}

function toDateOrNull(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function buildOpportunityCode(opportunityId) {
  return `OPP-${String(opportunityId).padStart(4, '0')}`;
}

export async function list(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const filters = {
    search: trimOrNull(query.search, 100),
    stageId: toIntOrNull(query.stageId),
    customerId: toIntOrNull(query.customerId),
    leadId: toIntOrNull(query.leadId),
    assignedTo: toIntOrNull(query.assignedTo),
    status: trimOrNull(query.status, 20)?.toUpperCase() || null,
    priority: trimOrNull(query.priority, 20)?.toUpperCase() || null,
    from: toDateOrNull(query.from),
    to: toDateOrNull(query.to),
  };
  return repo.listByCompany(pool, companyId, filters);
}

export async function getById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const row = await repo.findById(pool, companyId, Number(id));
  if (!row) { const e = new Error('Opportunity not found'); e.status = 404; throw e; }
  return row;
}

function buildPayload(body) {
  return {
    opportunityDate: toDateOrNull(body.opportunityDate ?? body.opportunity_date),
    customerId: toIntOrNull(body.customerId ?? body.customer_id),
    leadId: toIntOrNull(body.leadId ?? body.lead_id),
    opportunityStageId: toIntOrNull(body.opportunityStageId ?? body.opportunity_stage_id),
    opportunityName: requiredStr(body.opportunityName ?? body.opportunity_name, 'opportunityName', 200),
    estimatedValue: toNumberOrNull(body.estimatedValue ?? body.estimated_value),
    probabilityPercent: toNumberOrNull(body.probabilityPercent ?? body.probability_percent),
    expectedCloseDate: toDateOrNull(body.expectedCloseDate ?? body.expected_close_date),
    assignedToStaffId: toIntOrNull(body.assignedToStaffId ?? body.assigned_to_staff_id),
    sourceReference: trimOrNull(body.sourceReference ?? body.source_reference, 100),
    priority: normPriority(body.priority),
    contactPerson: trimOrNull(body.contactPerson ?? body.contact_person, 200),
    contactMobile: trimOrNull(body.contactMobile ?? body.contact_mobile, 30),
    contactEmail: trimOrNull(body.contactEmail ?? body.contact_email, 150),
    productsText: trimOrNull(body.productsText ?? body.products_text, 4000),
    description: trimOrNull(body.description, 4000),
    remarks: trimOrNull(body.remarks, 4000),
  };
}

export async function create(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const base = buildPayload(body);
  if (base.opportunityStageId == null) {
    const e = new Error('opportunityStageId is required'); e.status = 400; throw e;
  }
  const status = normStatus(body.status);
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))',
      [`biz.opportunity_master:${companyId}`]);
    const opportunityId = await repo.nextOpportunityId(client, companyId);
    return repo.insert(client, {
      ...base,
      companyId,
      branchId,
      opportunityId,
      opportunityCode: buildOpportunityCode(opportunityId),
      status,
      actorStaffId: actorStaffId(authStaff),
    });
  });
}

export async function update(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const base = buildPayload(body);
  const updated = await repo.update(pool, companyId, Number(id), {
    ...base,
    actorStaffId: actorStaffId(authStaff),
  });
  if (!updated) { const e = new Error('Opportunity not found'); e.status = 404; throw e; }
  return updated;
}

export async function setStatus(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const status = normStatus(body.status);
  if (status === 'CANCELLED') {
    const e = new Error('Use DELETE to cancel'); e.status = 400; throw e;
  }
  const reason = trimOrNull(body.reason ?? body.wonLostReason ?? body.won_lost_reason, 300);
  const updated = await repo.setStatus(pool, companyId, Number(id), status, reason, actorStaffId(authStaff));
  if (!updated) { const e = new Error('Opportunity not found'); e.status = 404; throw e; }
  return updated;
}

export async function remove(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const ok = await repo.softDelete(pool, companyId, Number(id), actorStaffId(authStaff));
  if (!ok) { const e = new Error('Opportunity not found'); e.status = 404; throw e; }
  return { ok: true };
}
