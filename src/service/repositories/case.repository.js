/** Data access for service.case_master and its status history. */

function mapCaseRow(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    caseId: Number(r.case_id),
    caseCode: r.case_code,
    customerId: Number(r.customer_id),
    serviceId: Number(r.service_id),
    status: r.status,
    priority: r.priority,
    assignedStaffId: r.assigned_staff_id != null ? Number(r.assigned_staff_id) : null,
    openedAt: r.opened_at,
    dueDate: r.due_date,
    completedAt: r.completed_at,
    governmentFee: Number(r.government_fee),
    serviceCharge: Number(r.service_charge),
    vatPercent: Number(r.vat_percent),
    vatAmount: Number(r.vat_amount),
    quotedTotal: Number(r.quoted_total),
    notes: r.notes,
    recordStatus: r.record_status,
    branchId: Number(r.branch_id),
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
    ...(r.task_total != null ? { taskTotal: Number(r.task_total), taskDone: Number(r.task_done) } : {}),
  };
}

export async function customerExists(client, companyId, customerId) {
  const { rows } = await client.query(
    `SELECT 1 FROM biz.customer_master
      WHERE company_id = $1 AND customer_id = $2 AND (status IS NULL OR status = 'ACTIVE') LIMIT 1`,
    [companyId, customerId]
  );
  return rows.length > 0;
}

export async function nextCaseId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(case_id), 0) + 1 AS n FROM service.case_master WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].n);
}

export async function listByCompany(pool, companyId, filters = {}) {
  const where = [`cm.company_id = $1`, `cm.record_status <> 'DELETED'`];
  const params = [companyId];
  let i = 2;

  if (filters.status) { where.push(`cm.status = $${i++}`); params.push(filters.status); }
  if (filters.assignedStaffId != null) { where.push(`cm.assigned_staff_id = $${i++}`); params.push(filters.assignedStaffId); }
  if (filters.customerId != null) { where.push(`cm.customer_id = $${i++}`); params.push(filters.customerId); }
  if (filters.search) {
    where.push(`cm.case_code ILIKE $${i}`);
    params.push(`%${filters.search}%`); i++;
  }

  const { rows } = await pool.query(
    `SELECT cm.*, COALESCE(t.total, 0) AS task_total, COALESCE(t.done, 0) AS task_done
       FROM service.case_master cm
       LEFT JOIN (
         SELECT case_id, COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'DONE') AS done
           FROM service.case_task GROUP BY case_id
       ) t ON t.case_id = cm.id
      WHERE ${where.join(' AND ')}
      ORDER BY cm.opened_at DESC, cm.id DESC`,
    params
  );
  return rows.map(mapCaseRow);
}

export async function findById(pool, companyId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM service.case_master
      WHERE company_id = $1 AND id = $2 AND record_status <> 'DELETED'`,
    [companyId, id]
  );
  return rows[0] ? mapCaseRow(rows[0]) : null;
}

export async function insert(client, p) {
  const { rows } = await client.query(
    `INSERT INTO service.case_master
       (company_id, branch_id, case_id, case_code, customer_id, service_id,
        status, priority, assigned_staff_id, due_date,
        government_fee, service_charge, vat_percent, vat_amount, quoted_total, notes,
        record_status, created_by, modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,'NEW',$7,$8,$9,$10,$11,$12,$13,$14,$15,'ACTIVE',$16,$16)
     RETURNING *`,
    [p.companyId, p.branchId, p.caseId, p.caseCode, p.customerId, p.serviceId,
     p.priority, p.assignedStaffId, p.dueDate,
     p.governmentFee, p.serviceCharge, p.vatPercent, p.vatAmount, p.quotedTotal, p.notes,
     p.actorStaffId]
  );
  return mapCaseRow(rows[0]);
}

export async function updateStatus(client, companyId, id, { status, actorStaffId }) {
  const completedAtClause = status === 'COMPLETED' ? `, completed_at = COALESCE(completed_at, NOW())` : '';
  const { rows } = await client.query(
    `UPDATE service.case_master SET
        status = $3, modified_by = $4, modified_at = NOW() ${completedAtClause}
      WHERE company_id = $1 AND id = $2 AND record_status <> 'DELETED'
      RETURNING *`,
    [companyId, id, status, actorStaffId]
  );
  return rows[0] ? mapCaseRow(rows[0]) : null;
}

export async function updateFields(pool, companyId, id, p) {
  const { rows } = await pool.query(
    `UPDATE service.case_master SET
        priority = COALESCE($3, priority),
        assigned_staff_id = COALESCE($4, assigned_staff_id),
        due_date = COALESCE($5, due_date),
        notes = COALESCE($6, notes),
        modified_by = $7, modified_at = NOW()
      WHERE company_id = $1 AND id = $2 AND record_status <> 'DELETED'
      RETURNING *`,
    [companyId, id, p.priority ?? null, p.assignedStaffId ?? null, p.dueDate ?? null, p.notes ?? null, p.actorStaffId]
  );
  return rows[0] ? mapCaseRow(rows[0]) : null;
}

export async function insertStatusHistory(client, { companyId, caseId, fromStatus, toStatus, changedBy, remarks }) {
  await client.query(
    `INSERT INTO service.case_status_history (company_id, case_id, from_status, to_status, changed_by, remarks)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [companyId, caseId, fromStatus, toStatus, changedBy, remarks ?? null]
  );
}

export async function getStatusHistory(pool, caseId) {
  const { rows } = await pool.query(
    `SELECT * FROM service.case_status_history WHERE case_id = $1 ORDER BY changed_at`,
    [caseId]
  );
  return rows.map(r => ({
    id: Number(r.id), fromStatus: r.from_status, toStatus: r.to_status,
    changedBy: r.changed_by != null ? Number(r.changed_by) : null,
    changedAt: r.changed_at, remarks: r.remarks,
  }));
}

// ── Tasks ─────────────────────────────────────────────────────────────────

function mapTask(r) {
  return {
    id: Number(r.id), taskId: Number(r.task_id), taskName: r.task_name, status: r.status,
    assigneeStaffId: r.assignee_staff_id != null ? Number(r.assignee_staff_id) : null,
    dueDate: r.due_date, notes: r.notes, sortOrder: Number(r.sort_order),
    completedAt: r.completed_at, caseId: Number(r.case_id),
  };
}

export async function insertTasks(client, companyId, caseId, tasks) {
  const inserted = [];
  for (const [i, t] of tasks.entries()) {
    const { rows } = await client.query(
      `INSERT INTO service.case_task
         (company_id, case_id, task_id, task_name, status, assignee_staff_id, due_date, sort_order)
       VALUES ($1,$2,$3,$4,'PENDING',$5,$6,$7)
       RETURNING *`,
      [companyId, caseId, i + 1, t.taskName, t.assigneeStaffId ?? null, t.dueDate ?? null, i]
    );
    inserted.push(mapTask(rows[0]));
  }
  return inserted;
}

export async function listTasksByCase(pool, caseId) {
  const { rows } = await pool.query(
    `SELECT * FROM service.case_task WHERE case_id = $1 ORDER BY sort_order, task_id`,
    [caseId]
  );
  return rows.map(mapTask);
}

export async function listTasksByCompany(pool, companyId, filters = {}) {
  const where = [`ct.company_id = $1`, `cm.record_status <> 'DELETED'`, `cm.status NOT IN ('COMPLETED','CANCELLED')`];
  const params = [companyId];
  let i = 2;
  if (filters.assigneeStaffId != null) { where.push(`ct.assignee_staff_id = $${i++}`); params.push(filters.assigneeStaffId); }

  const { rows } = await pool.query(
    `SELECT ct.*, cm.case_code, cm.customer_id, cm.service_id, cm.priority AS case_priority
       FROM service.case_task ct
       JOIN service.case_master cm ON cm.id = ct.case_id
      WHERE ${where.join(' AND ')}
      ORDER BY ct.due_date NULLS LAST, ct.id`,
    params
  );
  return rows.map(r => ({
    ...mapTask(r),
    caseCode: r.case_code,
    customerId: Number(r.customer_id),
    serviceId: Number(r.service_id),
    casePriority: r.case_priority,
  }));
}

export async function updateTask(pool, companyId, caseId, taskId, p) {
  const completedAtClause = p.status === 'DONE' ? `, completed_at = COALESCE(completed_at, NOW())`
    : p.status ? `, completed_at = NULL` : '';
  const { rows } = await pool.query(
    `UPDATE service.case_task SET
        status = COALESCE($4, status),
        assignee_staff_id = COALESCE($5, assignee_staff_id),
        due_date = COALESCE($6, due_date),
        notes = COALESCE($7, notes),
        modified_at = NOW() ${completedAtClause}
      WHERE company_id = $1 AND case_id = $2 AND task_id = $3
      RETURNING *`,
    [companyId, caseId, taskId, p.status ?? null, p.assigneeStaffId ?? null, p.dueDate ?? null, p.notes ?? null]
  );
  return rows[0] ? mapTask(rows[0]) : null;
}

// ── Documents ─────────────────────────────────────────────────────────────

function mapDocument(r) {
  return {
    id: Number(r.id), documentId: Number(r.document_id), documentName: r.document_name,
    status: r.status, fileName: r.file_name, filePath: r.file_path, fileSize: r.file_size,
    expiryDate: r.expiry_date, uploadedAt: r.uploaded_at,
    uploadedBy: r.uploaded_by != null ? Number(r.uploaded_by) : null, caseId: Number(r.case_id),
  };
}

export async function insertDocuments(client, companyId, caseId, documents) {
  const inserted = [];
  for (const [i, d] of documents.entries()) {
    const { rows } = await client.query(
      `INSERT INTO service.case_document
         (company_id, case_id, document_id, document_name, status, expiry_date)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [companyId, caseId, i + 1, d.documentName, d.status || 'PENDING', d.expiryDate ?? null]
    );
    inserted.push(mapDocument(rows[0]));
  }
  return inserted;
}

export async function addDocument(pool, companyId, caseId, d) {
  const { rows: idRows } = await pool.query(
    `SELECT COALESCE(MAX(document_id), 0) + 1 AS n FROM service.case_document WHERE case_id = $1`,
    [caseId]
  );
  const documentId = Number(idRows[0].n);
  const { rows } = await pool.query(
    `INSERT INTO service.case_document (company_id, case_id, document_id, document_name, status, expiry_date)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [companyId, caseId, documentId, d.documentName, d.status || 'PENDING', d.expiryDate ?? null]
  );
  return mapDocument(rows[0]);
}

export async function listDocumentsByCase(pool, caseId) {
  const { rows } = await pool.query(
    `SELECT * FROM service.case_document WHERE case_id = $1 ORDER BY document_id`,
    [caseId]
  );
  return rows.map(mapDocument);
}

export async function listAllDocuments(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT cd.*, cm.case_code, cm.customer_id, cm.service_id
       FROM service.case_document cd
       JOIN service.case_master cm ON cm.id = cd.case_id
      WHERE cd.company_id = $1 AND cm.record_status <> 'DELETED'
      ORDER BY cd.expiry_date NULLS LAST`,
    [companyId]
  );
  return rows.map(r => ({ ...mapDocument(r), caseCode: r.case_code, customerId: Number(r.customer_id), serviceId: Number(r.service_id) }));
}

export async function getExpiringDocuments(pool, companyId, { fromDays, toDays }) {
  const { rows } = await pool.query(
    `SELECT cd.*, cm.case_code, cm.customer_id, cm.service_id
       FROM service.case_document cd
       JOIN service.case_master cm ON cm.id = cd.case_id
      WHERE cd.company_id = $1 AND cm.record_status <> 'DELETED' AND cd.expiry_date IS NOT NULL
        AND cd.expiry_date >= CURRENT_DATE + ($2 || ' days')::interval
        AND cd.expiry_date <= CURRENT_DATE + ($3 || ' days')::interval
      ORDER BY cd.expiry_date`,
    [companyId, fromDays, toDays]
  );
  return rows.map(r => ({ ...mapDocument(r), caseCode: r.case_code, customerId: Number(r.customer_id), serviceId: Number(r.service_id) }));
}

export async function updateDocument(pool, companyId, caseId, documentId, p) {
  const { rows } = await pool.query(
    `UPDATE service.case_document SET
        status = COALESCE($4, status),
        expiry_date = $5,
        file_name = COALESCE($6, file_name),
        file_path = COALESCE($7, file_path),
        uploaded_at = CASE WHEN $4 = 'RECEIVED' THEN COALESCE(uploaded_at, NOW()) ELSE uploaded_at END,
        modified_at = NOW()
      WHERE company_id = $1 AND case_id = $2 AND document_id = $3
      RETURNING *`,
    [companyId, caseId, documentId, p.status ?? null, p.expiryDate === undefined ? null : p.expiryDate, p.fileName ?? null, p.filePath ?? null]
  );
  return rows[0] ? mapDocument(rows[0]) : null;
}

// ── Payments ──────────────────────────────────────────────────────────────

function mapPayment(r) {
  return {
    id: Number(r.id), paymentId: Number(r.payment_id), paymentType: r.payment_type,
    amount: Number(r.amount), paymentMethod: r.payment_method, paidBy: r.paid_by,
    paymentDate: r.payment_date, reference: r.reference, remarks: r.remarks,
    recordStatus: r.record_status, caseId: Number(r.case_id), createdAt: r.created_at,
  };
}

export async function addPayment(client, { companyId, branchId, caseId, paymentType, amount, paymentMethod, paidBy, paymentDate, reference, remarks, actorStaffId }) {
  const { rows: idRows } = await client.query(
    `SELECT COALESCE(MAX(payment_id), 0) + 1 AS n FROM service.case_payment WHERE case_id = $1`,
    [caseId]
  );
  const paymentId = Number(idRows[0].n);
  const { rows } = await client.query(
    `INSERT INTO service.case_payment
       (company_id, branch_id, case_id, payment_id, payment_type, amount, payment_method,
        paid_by, payment_date, reference, remarks, record_status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9, CURRENT_DATE),$10,$11,'ACTIVE',$12)
     RETURNING *`,
    [companyId, branchId, caseId, paymentId, paymentType, amount, paymentMethod, paidBy, paymentDate, reference, remarks, actorStaffId]
  );
  return mapPayment(rows[0]);
}

export async function listPaymentsByCase(pool, caseId) {
  const { rows } = await pool.query(
    `SELECT * FROM service.case_payment WHERE case_id = $1 AND record_status <> 'DELETED' ORDER BY payment_date, payment_id`,
    [caseId]
  );
  return rows.map(mapPayment);
}

export async function listPaymentsByCompany(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT cp.*, cm.case_code, cm.customer_id, cm.service_id
       FROM service.case_payment cp
       JOIN service.case_master cm ON cm.id = cp.case_id
      WHERE cp.company_id = $1 AND cp.record_status <> 'DELETED'
      ORDER BY cp.payment_date DESC, cp.id DESC`,
    [companyId]
  );
  return rows.map(r => ({ ...mapPayment(r), caseCode: r.case_code, customerId: Number(r.customer_id), serviceId: Number(r.service_id) }));
}

export async function sumPaidForCase(pool, caseId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS paid FROM service.case_payment
      WHERE case_id = $1 AND record_status <> 'DELETED'`,
    [caseId]
  );
  return Number(rows[0].paid);
}

// ── Dashboard aggregates ─────────────────────────────────────────────────

export async function dashboardCounts(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('COMPLETED','CANCELLED'))       AS open_cases,
        COUNT(*) FILTER (WHERE status = 'COMPLETED')                          AS completed_cases,
        COUNT(*) FILTER (WHERE due_date = CURRENT_DATE AND status NOT IN ('COMPLETED','CANCELLED')) AS today_jobs
       FROM service.case_master
      WHERE company_id = $1 AND record_status <> 'DELETED'`,
    [companyId]
  );
  const r = rows[0];
  return { openCases: Number(r.open_cases), completedCases: Number(r.completed_cases), todayJobs: Number(r.today_jobs) };
}

export async function pendingTaskCount(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS n
       FROM service.case_task ct
       JOIN service.case_master cm ON cm.id = ct.case_id
      WHERE ct.company_id = $1 AND ct.status <> 'DONE' AND cm.record_status <> 'DELETED'
        AND cm.status NOT IN ('COMPLETED','CANCELLED')`,
    [companyId]
  );
  return Number(rows[0].n);
}

export async function revenueTotal(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM service.case_payment
      WHERE company_id = $1 AND record_status <> 'DELETED'`,
    [companyId]
  );
  return Number(rows[0].total);
}

export async function staffWorkload(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT
        cm.assigned_staff_id AS staff_id,
        COUNT(DISTINCT cm.id) FILTER (WHERE cm.status NOT IN ('COMPLETED','CANCELLED')) AS open_cases,
        COUNT(ct.id) FILTER (WHERE ct.status <> 'DONE') AS open_tasks
       FROM service.case_master cm
       LEFT JOIN service.case_task ct ON ct.case_id = cm.id AND ct.assignee_staff_id = cm.assigned_staff_id
      WHERE cm.company_id = $1 AND cm.record_status <> 'DELETED' AND cm.assigned_staff_id IS NOT NULL
      GROUP BY cm.assigned_staff_id`,
    [companyId]
  );
  return rows.map(r => ({
    staffId: Number(r.staff_id), openCases: Number(r.open_cases), openTasks: Number(r.open_tasks),
  }));
}

export async function pendingPayments(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT cm.*, COALESCE(pay.paid, 0) AS paid
       FROM service.case_master cm
       LEFT JOIN (
         SELECT case_id, SUM(amount) AS paid FROM service.case_payment
          WHERE record_status <> 'DELETED' GROUP BY case_id
       ) pay ON pay.case_id = cm.id
      WHERE cm.company_id = $1 AND cm.record_status <> 'DELETED'
        AND cm.status NOT IN ('COMPLETED','CANCELLED')
        AND cm.quoted_total > COALESCE(pay.paid, 0)`,
    [companyId]
  );
  return rows.map(r => ({ ...mapCaseRow(r), paid: Number(r.paid), balance: Number(r.quoted_total) - Number(r.paid) }));
}
