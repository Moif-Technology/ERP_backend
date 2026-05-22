import { withTransaction } from '../config/db.js';
import * as repo from '../repositories/crmLead.repository.js';
import {
  requiredStr, trimOrNull, toIntOrNull, toNumberOrNull,
  requireCompanyId, requireBranchId, actorStaffId,
} from '../utils/crmHelpers.js';

function toDateOrNull(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function buildLeadCode(leadId) {
  return `LEAD-${String(leadId).padStart(4, '0')}`;
}

export async function list(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const filters = {
    search: trimOrNull(query.search, 100),
    sourceId: toIntOrNull(query.sourceId),
    statusId: toIntOrNull(query.statusId),
    assignedTo: toIntOrNull(query.assignedTo),
    from: toDateOrNull(query.from),
    to: toDateOrNull(query.to),
  };
  return repo.listByCompany(pool, companyId, filters);
}

export async function getById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const row = await repo.findById(pool, companyId, Number(id));
  if (!row) { const e = new Error('Lead not found'); e.status = 404; throw e; }
  return row;
}

function buildPayload(body) {
  return {
    leadDate: toDateOrNull(body.leadDate ?? body.lead_date),
    leadTitle: trimOrNull(body.leadTitle ?? body.lead_title, 200),
    leadName: requiredStr(body.leadName ?? body.lead_name, 'leadName', 200),
    companyName: trimOrNull(body.companyName ?? body.company_name, 200),
    mobileNo: trimOrNull(body.mobileNo ?? body.mobile_no, 30),
    whatsappNo: trimOrNull(body.whatsappNo ?? body.whatsapp_no, 30),
    email: trimOrNull(body.email, 150),
    leadSourceId: toIntOrNull(body.leadSourceId ?? body.lead_source_id),
    leadStatusId: toIntOrNull(body.leadStatusId ?? body.lead_status_id),
    assignedToStaffId: toIntOrNull(body.assignedToStaffId ?? body.assigned_to_staff_id),
    customerId: toIntOrNull(body.customerId ?? body.customer_id),
    expectedValue: toNumberOrNull(body.expectedValue ?? body.expected_value),
    probabilityPercent: toNumberOrNull(body.probabilityPercent ?? body.probability_percent),
    nextFollowupAt: toDateOrNull(body.nextFollowupAt ?? body.next_followup_at),
    address: trimOrNull(body.address, 300),
    city: trimOrNull(body.city, 100),
    country: trimOrNull(body.country, 100),
    remarks: trimOrNull(body.remarks, 4000),
  };
}

export async function create(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const base = buildPayload(body);
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))',
      [`biz.lead_master:${companyId}`]);
    const leadId = await repo.nextLeadId(client, companyId);
    return repo.insert(client, {
      ...base,
      companyId,
      branchId,
      leadId,
      leadCode: buildLeadCode(leadId),
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
  if (!updated) { const e = new Error('Lead not found'); e.status = 404; throw e; }
  return updated;
}

export async function remove(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const ok = await repo.softDelete(pool, companyId, Number(id), actorStaffId(authStaff));
  if (!ok) { const e = new Error('Lead not found'); e.status = 404; throw e; }
  return { ok: true };
}
