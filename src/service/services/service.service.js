import { withTransaction } from '../../config/db.js';
import * as repo from '../repositories/service.repository.js';
import { nextDocNo } from '../../shared/services/docSequence.service.js';
import {
  requiredStr, trimOrNull, toIntOrNull, toNumberOrNull, toBool,
  requireCompanyId, requireBranchId, actorStaffId,
} from '../../utils/crmHelpers.js';

async function attachChildren(pool, row) {
  const children = await repo.getChildren(pool, row.id);
  return { ...row, ...children };
}

export async function list(pool, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const services = await repo.listByCompany(pool, companyId);
  return Promise.all(services.map((s) => attachChildren(pool, s)));
}

export async function getById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const row = await repo.findById(pool, companyId, Number(id));
  if (!row) { const e = new Error('Service not found'); e.status = 404; throw e; }
  return attachChildren(pool, row);
}

function buildServicePayload(body) {
  return {
    categoryId: toIntOrNull(body.categoryId ?? body.category_id),
    parentServiceId: toIntOrNull(body.parentServiceId ?? body.parent_service_id),
    serviceName: requiredStr(body.serviceName ?? body.service_name, 'serviceName', 200),
    isGroup: toBool(body.isGroup ?? body.is_group, false),
    governmentFee: toNumberOrNull(body.governmentFee ?? body.government_fee) ?? 0,
    serviceCharge: toNumberOrNull(body.serviceCharge ?? body.service_charge) ?? 0,
    vatPercent: toNumberOrNull(body.vatPercent ?? body.vat_percent) ?? 0,
    expectedDays: toIntOrNull(body.expectedDays ?? body.expected_days) ?? 1,
    expiryMonths: toIntOrNull(body.expiryMonths ?? body.expiry_months),
    isActive: toBool(body.isActive ?? body.is_active, true),
    sortOrder: toIntOrNull(body.sortOrder ?? body.sort_order) ?? 0,
  };
}

function buildChildren(body) {
  const taskTemplates = Array.isArray(body.taskTemplates ?? body.task_templates)
    ? (body.taskTemplates ?? body.task_templates).map((t) => ({
        taskName: requiredStr(t.taskName ?? t.task_name, 'taskName', 150),
        defaultAssigneeStaffId: toIntOrNull(t.defaultAssigneeStaffId ?? t.default_assignee_staff_id),
        defaultDurationDays: toIntOrNull(t.defaultDurationDays ?? t.default_duration_days),
      }))
    : [];
  const documentRequirements = Array.isArray(body.documentRequirements ?? body.document_requirements)
    ? (body.documentRequirements ?? body.document_requirements).map((d) => ({
        documentName: requiredStr(d.documentName ?? d.document_name, 'documentName', 150),
        isMandatory: toBool(d.isMandatory ?? d.is_mandatory, true),
        hasExpiry: toBool(d.hasExpiry ?? d.has_expiry, false),
      }))
    : [];
  const reminderRules = Array.isArray(body.reminderRules ?? body.reminder_rules)
    ? (body.reminderRules ?? body.reminder_rules)
        .map((r) => ({ daysBefore: toIntOrNull(r.daysBefore ?? r.days_before ?? r), channel: trimOrNull(r.channel, 20) || 'SYSTEM' }))
        .filter((r) => r.daysBefore != null && r.daysBefore > 0)
    : [];
  return { taskTemplates, documentRequirements, reminderRules };
}

export async function create(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const payload = buildServicePayload(body);
  if (!payload.categoryId) { const e = new Error('categoryId is required'); e.status = 400; throw e; }
  const children = buildChildren(body);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [`service.service_master:${companyId}`]);
    const serviceId = await repo.nextServiceId(client, companyId);
    const serviceCode = await nextDocNo(client, { companyId, branchId, sequenceCode: 'SERVICE_CODE' });
    const created = await repo.insertService(client, {
      ...payload, companyId, serviceId, serviceCode, actorStaffId: actorStaffId(authStaff),
    });
    if (!payload.isGroup) {
      await repo.replaceChildren(client, companyId, created.id, children);
    }
    return { ...created, ...children };
  });
}

export async function update(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const payload = buildServicePayload(body);
  if (!payload.categoryId) { const e = new Error('categoryId is required'); e.status = 400; throw e; }
  const children = buildChildren(body);

  return withTransaction(async (client) => {
    const updated = await repo.updateService(client, companyId, Number(id), { ...payload, actorStaffId: actorStaffId(authStaff) });
    if (!updated) { const e = new Error('Service not found'); e.status = 404; throw e; }
    if (!payload.isGroup) {
      await repo.replaceChildren(client, companyId, updated.id, children);
    }
    return { ...updated, ...children };
  });
}

export async function remove(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const serviceId = Number(id);
  if (await repo.hasActiveChildren(pool, companyId, serviceId)) {
    const e = new Error('Service has sub-services. Delete or move them first.'); e.status = 409; throw e;
  }
  if (await repo.isUsedByCases(pool, companyId, serviceId)) {
    const e = new Error('Service is used by existing cases.'); e.status = 409; throw e;
  }
  const ok = await repo.softDelete(pool, companyId, serviceId, actorStaffId(authStaff));
  if (!ok) { const e = new Error('Service not found'); e.status = 404; throw e; }
  return { ok: true };
}
