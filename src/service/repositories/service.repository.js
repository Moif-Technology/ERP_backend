/**
 * Data access for service.service_master + its child config tables
 * (service_task_template, service_document_requirement, service_reminder_rule).
 * Children are always replaced wholesale on update (delete + reinsert) since the
 * catalogue editor UI saves the full checklist/document list/reminders in one go.
 */

function mapServiceRow(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    serviceId: Number(r.service_id),
    categoryId: Number(r.category_id),
    parentServiceId: r.parent_service_id != null ? Number(r.parent_service_id) : null,
    serviceCode: r.service_code,
    serviceName: r.service_name,
    isGroup: r.is_group,
    governmentFee: Number(r.government_fee),
    serviceCharge: Number(r.service_charge),
    vatPercent: Number(r.vat_percent),
    expectedDays: Number(r.expected_days),
    expiryMonths: r.expiry_months != null ? Number(r.expiry_months) : null,
    isActive: r.is_active,
    sortOrder: Number(r.sort_order),
    recordStatus: r.record_status,
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
  };
}

function mapTaskTemplate(r) {
  return {
    id: Number(r.id),
    taskName: r.task_name,
    sortOrder: Number(r.sort_order),
    defaultAssigneeStaffId: r.default_assignee_staff_id != null ? Number(r.default_assignee_staff_id) : null,
    defaultDurationDays: r.default_duration_days != null ? Number(r.default_duration_days) : null,
  };
}

function mapDocumentRequirement(r) {
  return {
    id: Number(r.id),
    documentName: r.document_name,
    isMandatory: r.is_mandatory,
    hasExpiry: r.has_expiry,
    sortOrder: Number(r.sort_order),
  };
}

function mapReminderRule(r) {
  return { id: Number(r.id), daysBefore: Number(r.days_before), channel: r.channel };
}

export async function nextServiceId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(service_id), 0) + 1 AS n
       FROM service.service_master WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].n);
}

export async function listByCompany(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT * FROM service.service_master
      WHERE company_id = $1 AND record_status <> 'DELETED'
      ORDER BY category_id, sort_order, service_name`,
    [companyId]
  );
  return rows.map(mapServiceRow);
}

export async function findById(pool, companyId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM service.service_master
      WHERE company_id = $1 AND id = $2 AND record_status <> 'DELETED'`,
    [companyId, id]
  );
  return rows[0] ? mapServiceRow(rows[0]) : null;
}

export async function getChildren(pool, serviceId) {
  const [tasks, docs, reminders] = await Promise.all([
    pool.query(`SELECT * FROM service.service_task_template WHERE service_id = $1 ORDER BY sort_order, id`, [serviceId]),
    pool.query(`SELECT * FROM service.service_document_requirement WHERE service_id = $1 ORDER BY sort_order, id`, [serviceId]),
    pool.query(`SELECT * FROM service.service_reminder_rule WHERE service_id = $1 ORDER BY days_before DESC`, [serviceId]),
  ]);
  return {
    taskTemplates: tasks.rows.map(mapTaskTemplate),
    documentRequirements: docs.rows.map(mapDocumentRequirement),
    reminderRules: reminders.rows.map(mapReminderRule),
  };
}

export async function insertService(client, p) {
  const { rows } = await client.query(
    `INSERT INTO service.service_master
       (company_id, service_id, category_id, parent_service_id, service_code, service_name,
        is_group, government_fee, service_charge, vat_percent, expected_days, expiry_months,
        is_active, sort_order, record_status, created_by, modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'ACTIVE',$15,$15)
     RETURNING *`,
    [p.companyId, p.serviceId, p.categoryId, p.parentServiceId, p.serviceCode, p.serviceName,
     p.isGroup, p.governmentFee, p.serviceCharge, p.vatPercent, p.expectedDays, p.expiryMonths,
     p.isActive, p.sortOrder, p.actorStaffId]
  );
  return mapServiceRow(rows[0]);
}

export async function updateService(client, companyId, id, p) {
  const { rows } = await client.query(
    `UPDATE service.service_master SET
        category_id = $3, parent_service_id = $4, service_name = $5,
        is_group = $6, government_fee = $7, service_charge = $8, vat_percent = $9,
        expected_days = $10, expiry_months = $11, is_active = $12, sort_order = $13,
        modified_by = $14, modified_at = NOW()
      WHERE company_id = $1 AND id = $2 AND record_status <> 'DELETED'
      RETURNING *`,
    [companyId, id, p.categoryId, p.parentServiceId, p.serviceName,
     p.isGroup, p.governmentFee, p.serviceCharge, p.vatPercent,
     p.expectedDays, p.expiryMonths, p.isActive, p.sortOrder, p.actorStaffId]
  );
  return rows[0] ? mapServiceRow(rows[0]) : null;
}

export async function replaceChildren(client, companyId, serviceId, { taskTemplates, documentRequirements, reminderRules }) {
  await client.query(`DELETE FROM service.service_task_template WHERE service_id = $1`, [serviceId]);
  await client.query(`DELETE FROM service.service_document_requirement WHERE service_id = $1`, [serviceId]);
  await client.query(`DELETE FROM service.service_reminder_rule WHERE service_id = $1`, [serviceId]);

  for (const [i, t] of taskTemplates.entries()) {
    await client.query(
      `INSERT INTO service.service_task_template
         (company_id, service_id, task_name, sort_order, default_assignee_staff_id, default_duration_days)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [companyId, serviceId, t.taskName, i, t.defaultAssigneeStaffId ?? null, t.defaultDurationDays ?? null]
    );
  }
  for (const [i, d] of documentRequirements.entries()) {
    await client.query(
      `INSERT INTO service.service_document_requirement
         (company_id, service_id, document_name, is_mandatory, has_expiry, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [companyId, serviceId, d.documentName, d.isMandatory !== false, !!d.hasExpiry, i]
    );
  }
  for (const r of reminderRules) {
    await client.query(
      `INSERT INTO service.service_reminder_rule (company_id, service_id, days_before, channel)
       VALUES ($1,$2,$3,$4) ON CONFLICT (service_id, days_before, channel) DO NOTHING`,
      [companyId, serviceId, r.daysBefore, r.channel || 'SYSTEM']
    );
  }
}

export async function softDelete(pool, companyId, id, actorStaffId) {
  const { rowCount } = await pool.query(
    `UPDATE service.service_master
        SET record_status = 'DELETED', modified_by = $3, modified_at = NOW()
      WHERE company_id = $1 AND id = $2 AND record_status <> 'DELETED'`,
    [companyId, id, actorStaffId]
  );
  return rowCount > 0;
}

export async function hasActiveChildren(pool, companyId, serviceId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM service.service_master
      WHERE company_id = $1 AND parent_service_id = $2 AND record_status <> 'DELETED' LIMIT 1`,
    [companyId, serviceId]
  );
  return rows.length > 0;
}

export async function isUsedByCases(pool, companyId, serviceId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM service.case_master
      WHERE company_id = $1 AND service_id = $2 AND record_status <> 'DELETED' LIMIT 1`,
    [companyId, serviceId]
  );
  return rows.length > 0;
}
