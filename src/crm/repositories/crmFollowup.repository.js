function mapRow(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    followupId: Number(r.followup_id),
    companyId: Number(r.company_id),
    branchId: Number(r.branch_id),
    customerId: r.customer_id != null ? Number(r.customer_id) : null,
    leadId: r.lead_id != null ? Number(r.lead_id) : null,
    opportunityId: r.opportunity_id != null ? Number(r.opportunity_id) : null,
    followupDate: r.followup_date,
    followupType: r.followup_type,
    subject: r.subject,
    priority: r.priority_level,
    status: r.status,
    assignedToStaffId: r.assigned_to_staff_id != null ? Number(r.assigned_to_staff_id) : null,
    notes: r.notes,
    completedAt: r.completed_at,
    completionNotes: r.completion_notes,
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
  };
}

export async function nextFollowupId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(followup_id), 0) + 1 AS n
       FROM biz.customer_followup
      WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].n);
}

export async function listByCompany(pool, companyId, filters = {}) {
  const where = [`company_id = $1`];
  const params = [companyId];
  let i = 2;

  if (filters.search) {
    where.push(`(subject ILIKE $${i} OR notes ILIKE $${i})`);
    params.push(`%${filters.search}%`);
    i++;
  }
  if (filters.status) { where.push(`status = $${i++}`); params.push(filters.status); }
  if (filters.priority) { where.push(`priority_level = $${i++}`); params.push(filters.priority); }
  if (filters.followupType) { where.push(`followup_type = $${i++}`); params.push(filters.followupType); }
  if (filters.assignedTo != null) { where.push(`assigned_to_staff_id = $${i++}`); params.push(filters.assignedTo); }
  if (filters.customerId != null) { where.push(`customer_id = $${i++}`); params.push(filters.customerId); }
  if (filters.leadId != null) { where.push(`lead_id = $${i++}`); params.push(filters.leadId); }
  if (filters.opportunityId != null) { where.push(`opportunity_id = $${i++}`); params.push(filters.opportunityId); }
  if (filters.from) { where.push(`followup_date >= $${i++}`); params.push(filters.from); }
  if (filters.to) { where.push(`followup_date <= $${i++}`); params.push(filters.to); }
  if (filters.overdue) { where.push(`status = 'PENDING' AND followup_date::date < CURRENT_DATE`); }
  if (filters.today) { where.push(`followup_date::date = CURRENT_DATE`); }

  const { rows } = await pool.query(
    `SELECT *
       FROM biz.customer_followup
      WHERE ${where.join(' AND ')}
      ORDER BY followup_date ASC, id DESC`,
    params
  );
  return rows.map(mapRow);
}

export async function findById(pool, companyId, id) {
  const { rows } = await pool.query(
    `SELECT *
       FROM biz.customer_followup
      WHERE company_id = $1
        AND id = $2`,
    [companyId, id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function insert(client, p) {
  const { rows } = await client.query(
    `INSERT INTO biz.customer_followup
       (company_id, branch_id, followup_id, customer_id, lead_id, opportunity_id,
        followup_date, followup_type, priority_level, subject, status,
        assigned_to_staff_id, notes, completion_notes, created_by, modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,
             $7,$8,$9,$10,COALESCE($11,'PENDING'),
             $12,$13,$14,$15,$15)
     RETURNING *`,
    [
      p.companyId, p.branchId, p.followupId, p.customerId, p.leadId, p.opportunityId,
      p.followupDate, p.followupType, p.priority, p.subject, p.status,
      p.assignedToStaffId, p.notes, p.completionNotes, p.actorStaffId,
    ]
  );
  return mapRow(rows[0]);
}

export async function update(pool, companyId, id, p) {
  const { rows } = await pool.query(
    `UPDATE biz.customer_followup SET
        customer_id = $3,
        lead_id = $4,
        opportunity_id = $5,
        followup_date = $6,
        followup_type = $7,
        priority_level = $8,
        subject = $9,
        status = $10,
        assigned_to_staff_id = $11,
        notes = $12,
        completion_notes = $13,
        completed_at = CASE
          WHEN $10 = 'COMPLETED' AND completed_at IS NULL THEN NOW()
          WHEN $10 <> 'COMPLETED' THEN NULL
          ELSE completed_at
        END,
        modified_by = $14,
        modified_at = NOW()
      WHERE company_id = $1
        AND id = $2
      RETURNING *`,
    [
      companyId, id, p.customerId, p.leadId, p.opportunityId, p.followupDate,
      p.followupType, p.priority, p.subject, p.status, p.assignedToStaffId,
      p.notes, p.completionNotes, p.actorStaffId,
    ]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function markCompleted(pool, companyId, id, completionNotes, actorStaffId) {
  const { rows } = await pool.query(
    `UPDATE biz.customer_followup
        SET status = 'COMPLETED',
            completed_at = NOW(),
            completion_notes = COALESCE($3, completion_notes),
            modified_by = $4,
            modified_at = NOW()
      WHERE company_id = $1
        AND id = $2
      RETURNING *`,
    [companyId, id, completionNotes, actorStaffId]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function softDelete(pool, companyId, id, actorStaffId) {
  const { rowCount } = await pool.query(
    `UPDATE biz.customer_followup
        SET status = 'CANCELLED',
            modified_by = $3,
            modified_at = NOW()
      WHERE company_id = $1
        AND id = $2`,
    [companyId, id, actorStaffId]
  );
  return rowCount > 0;
}
