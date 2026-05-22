/** Data access for biz.opportunity_master (company scoped, soft-cancel via status='CANCELLED'). */

function mapRow(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    opportunityId: Number(r.opportunity_id),
    opportunityCode: r.opportunity_code,
    opportunityDate: r.opportunity_date,
    customerId: r.customer_id != null ? Number(r.customer_id) : null,
    leadId: r.lead_id != null ? Number(r.lead_id) : null,
    opportunityStageId: r.opportunity_stage_id != null ? Number(r.opportunity_stage_id) : null,
    opportunityName: r.opportunity_name,
    estimatedValue: r.estimated_value != null ? Number(r.estimated_value) : 0,
    probabilityPercent: r.probability_percent != null ? Number(r.probability_percent) : 0,
    expectedCloseDate: r.expected_close_date,
    assignedToStaffId: r.assigned_to_staff_id != null ? Number(r.assigned_to_staff_id) : null,
    sourceReference: r.source_reference,
    remarks: r.remarks,
    status: r.status,
    wonAt: r.won_at,
    lostAt: r.lost_at,
    branchId: r.branch_id != null ? Number(r.branch_id) : null,
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
  };
}

export async function nextOpportunityId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(opportunity_id), 0) + 1 AS n
       FROM biz.opportunity_master WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].n);
}

export async function listByCompany(pool, companyId, filters = {}) {
  const where = [`company_id = $1`, `status <> 'CANCELLED'`];
  const params = [companyId];
  let i = 2;

  if (filters.search) {
    where.push(`(
      opportunity_name ILIKE $${i} OR opportunity_code ILIKE $${i} OR
      source_reference ILIKE $${i} OR remarks ILIKE $${i}
    )`);
    params.push(`%${filters.search}%`); i++;
  }
  if (filters.stageId != null)    { where.push(`opportunity_stage_id = $${i++}`); params.push(filters.stageId); }
  if (filters.customerId != null) { where.push(`customer_id = $${i++}`); params.push(filters.customerId); }
  if (filters.leadId != null)     { where.push(`lead_id = $${i++}`); params.push(filters.leadId); }
  if (filters.assignedTo != null) { where.push(`assigned_to_staff_id = $${i++}`); params.push(filters.assignedTo); }
  if (filters.status)             { where.push(`status = $${i++}`); params.push(filters.status); }
  if (filters.from)               { where.push(`opportunity_date >= $${i++}`); params.push(filters.from); }
  if (filters.to)                 { where.push(`opportunity_date <= $${i++}`); params.push(filters.to); }

  const { rows } = await pool.query(
    `SELECT * FROM biz.opportunity_master
      WHERE ${where.join(' AND ')}
      ORDER BY opportunity_date DESC, id DESC`,
    params
  );
  return rows.map(mapRow);
}

export async function findById(pool, companyId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM biz.opportunity_master
      WHERE company_id = $1 AND id = $2`,
    [companyId, id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function insert(client, p) {
  const { rows } = await client.query(
    `INSERT INTO biz.opportunity_master
       (company_id, branch_id, opportunity_id, opportunity_code, opportunity_date,
        customer_id, lead_id, opportunity_stage_id, opportunity_name,
        estimated_value, probability_percent, expected_close_date,
        assigned_to_staff_id, source_reference,
        remarks, status, created_by, modified_by)
     VALUES ($1,$2,$3,$4,COALESCE($5, NOW()),
             $6,$7,$8,$9,
             COALESCE($10,0),COALESCE($11,0),$12,
             $13,$14,
             $15,
             COALESCE($16,'OPEN'),$17,$17)
     RETURNING *`,
    [p.companyId, p.branchId, p.opportunityId, p.opportunityCode, p.opportunityDate,
     p.customerId, p.leadId, p.opportunityStageId, p.opportunityName,
     p.estimatedValue, p.probabilityPercent, p.expectedCloseDate,
     p.assignedToStaffId, p.sourceReference,
     p.remarks, p.status, p.actorStaffId]
  );
  return mapRow(rows[0]);
}

export async function update(pool, companyId, id, p) {
  const { rows } = await pool.query(
    `UPDATE biz.opportunity_master SET
        opportunity_date = COALESCE($3, opportunity_date),
        customer_id = $4, lead_id = $5,
        opportunity_stage_id = $6, opportunity_name = $7,
        estimated_value = COALESCE($8, estimated_value),
        probability_percent = COALESCE($9, probability_percent),
        expected_close_date = $10,
        assigned_to_staff_id = $11, source_reference = $12,
        remarks = $13,
        modified_by = $14, modified_at = NOW()
      WHERE company_id = $1 AND id = $2 AND status <> 'CANCELLED'
      RETURNING *`,
    [companyId, id, p.opportunityDate,
     p.customerId, p.leadId,
     p.opportunityStageId, p.opportunityName,
     p.estimatedValue, p.probabilityPercent, p.expectedCloseDate,
     p.assignedToStaffId, p.sourceReference,
     p.remarks, p.actorStaffId]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function setStatus(pool, companyId, id, status, reason, actorStaffId) {
  const stampCol =
    status === 'WON' ? 'won_at = NOW(),' :
    status === 'LOST' ? 'lost_at = NOW(),' : '';
  const { rows } = await pool.query(
    `UPDATE biz.opportunity_master
        SET status = $3, ${stampCol}
            remarks = CASE
              WHEN $4 IS NULL OR $4 = '' THEN remarks
              WHEN remarks IS NULL OR remarks = '' THEN $4
              ELSE remarks || E'\n' || $4
            END,
            modified_by = $5, modified_at = NOW()
      WHERE company_id = $1 AND id = $2
      RETURNING *`,
    [companyId, id, status, reason || null, actorStaffId]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function softDelete(pool, companyId, id, actorStaffId) {
  const { rowCount } = await pool.query(
    `UPDATE biz.opportunity_master
        SET status = 'CANCELLED', modified_by = $3, modified_at = NOW()
      WHERE company_id = $1 AND id = $2 AND status <> 'CANCELLED'`,
    [companyId, id, actorStaffId]
  );
  return rowCount > 0;
}
