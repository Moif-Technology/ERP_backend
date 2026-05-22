function mapRow(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    interactionId: Number(r.interaction_id),
    companyId: Number(r.company_id),
    branchId: Number(r.branch_id),
    customerId: r.customer_id != null ? Number(r.customer_id) : null,
    leadId: r.lead_id != null ? Number(r.lead_id) : null,
    interactionDate: r.interaction_date,
    interactionType: r.interaction_type,
    interactionMode: r.interaction_mode,
    subject: r.subject,
    interactionSummary: r.interaction_summary,
    outcome: r.outcome,
    nextActionAt: r.next_action_at,
    staffId: r.staff_id != null ? Number(r.staff_id) : null,
    recordStatus: r.record_status,
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
  };
}

export async function nextInteractionId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(interaction_id), 0) + 1 AS n
       FROM biz.customer_interaction_log
      WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].n);
}

export async function listByCompany(pool, companyId, filters = {}) {
  const where = [`company_id = $1`, `record_status <> 'DELETED'`];
  const params = [companyId];
  let i = 2;

  if (filters.search) {
    where.push(`(subject ILIKE $${i} OR interaction_summary ILIKE $${i} OR outcome ILIKE $${i})`);
    params.push(`%${filters.search}%`);
    i++;
  }
  if (filters.interactionType) { where.push(`interaction_type = $${i++}`); params.push(filters.interactionType); }
  if (filters.interactionMode) { where.push(`interaction_mode = $${i++}`); params.push(filters.interactionMode); }
  if (filters.staffId != null) { where.push(`staff_id = $${i++}`); params.push(filters.staffId); }
  if (filters.customerId != null) { where.push(`customer_id = $${i++}`); params.push(filters.customerId); }
  if (filters.leadId != null) { where.push(`lead_id = $${i++}`); params.push(filters.leadId); }
  if (filters.linkAny?.length) {
    const orParts = [];
    for (const cond of filters.linkAny) {
      if (cond.customerId != null) {
        orParts.push(`customer_id = $${i++}`);
        params.push(cond.customerId);
      }
      if (cond.leadId != null) {
        orParts.push(`lead_id = $${i++}`);
        params.push(cond.leadId);
      }
    }
    if (orParts.length) where.push(`(${orParts.join(' OR ')})`);
  }
  if (filters.from) { where.push(`interaction_date >= $${i++}`); params.push(filters.from); }
  if (filters.to) { where.push(`interaction_date <= $${i++}`); params.push(filters.to); }

  const { rows } = await pool.query(
    `SELECT *
       FROM biz.customer_interaction_log
      WHERE ${where.join(' AND ')}
      ORDER BY interaction_date DESC, id DESC`,
    params
  );
  return rows.map(mapRow);
}

export async function findById(pool, companyId, id) {
  const { rows } = await pool.query(
    `SELECT *
       FROM biz.customer_interaction_log
      WHERE company_id = $1
        AND id = $2
        AND record_status <> 'DELETED'`,
    [companyId, id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function insert(client, p) {
  const { rows } = await client.query(
    `INSERT INTO biz.customer_interaction_log
       (company_id, branch_id, interaction_id, customer_id, lead_id,
        interaction_date, interaction_type, interaction_mode, subject, interaction_summary,
        outcome, next_action_at, staff_id, created_by, modified_by)
     VALUES ($1,$2,$3,$4,$5,
             COALESCE($6, NOW()),$7,$8,$9,$10,
             $11,$12,$13,$14,$14)
     RETURNING *`,
    [
      p.companyId, p.branchId, p.interactionId, p.customerId, p.leadId,
      p.interactionDate, p.interactionType, p.interactionMode, p.subject, p.interactionSummary,
      p.outcome, p.nextActionAt, p.staffId, p.actorStaffId,
    ]
  );
  return mapRow(rows[0]);
}

export async function update(pool, companyId, id, p) {
  const { rows } = await pool.query(
    `UPDATE biz.customer_interaction_log SET
        customer_id = $3,
        lead_id = $4,
        interaction_date = COALESCE($5, interaction_date),
        interaction_type = $6,
        interaction_mode = $7,
        subject = $8,
        interaction_summary = $9,
        outcome = $10,
        next_action_at = $11,
        staff_id = $12,
        modified_by = $13,
        modified_at = NOW()
      WHERE company_id = $1
        AND id = $2
        AND record_status <> 'DELETED'
      RETURNING *`,
    [
      companyId, id, p.customerId, p.leadId, p.interactionDate,
      p.interactionType, p.interactionMode, p.subject, p.interactionSummary,
      p.outcome, p.nextActionAt, p.staffId, p.actorStaffId,
    ]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function softDelete(pool, companyId, id, actorStaffId) {
  const { rowCount } = await pool.query(
    `UPDATE biz.customer_interaction_log
        SET record_status = 'DELETED',
            modified_by = $3,
            modified_at = NOW()
      WHERE company_id = $1
        AND id = $2
        AND record_status <> 'DELETED'`,
    [companyId, id, actorStaffId]
  );
  return rowCount > 0;
}
