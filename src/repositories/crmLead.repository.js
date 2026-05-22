/** Data access for biz.lead_master (company scoped, soft-delete via record_status). */

function mapRow(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    leadId: Number(r.lead_id),
    leadCode: r.lead_code,
    leadDate: r.lead_date,
    leadTitle: r.lead_title,
    leadName: r.lead_name,
    companyName: r.company_name,
    mobileNo: r.mobile_no,
    whatsappNo: r.whatsapp_no,
    email: r.email,
    leadSourceId: r.lead_source_id != null ? Number(r.lead_source_id) : null,
    leadStatusId: r.lead_status_id != null ? Number(r.lead_status_id) : null,
    assignedToStaffId: r.assigned_to_staff_id != null ? Number(r.assigned_to_staff_id) : null,
    customerId: r.customer_id != null ? Number(r.customer_id) : null,
    expectedValue: r.expected_value != null ? Number(r.expected_value) : null,
    probabilityPercent: r.probability_percent != null ? Number(r.probability_percent) : null,
    nextFollowupAt: r.next_followup_at,
    address: r.address,
    city: r.city,
    country: r.country,
    remarks: r.remarks,
    convertedAt: r.converted_at,
    lostAt: r.lost_at,
    recordStatus: r.record_status,
    branchId: r.branch_id != null ? Number(r.branch_id) : null,
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
  };
}

export async function nextLeadId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(lead_id), 0) + 1 AS n
       FROM biz.lead_master WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].n);
}

export async function listByCompany(pool, companyId, filters = {}) {
  const where = [`company_id = $1`, `record_status <> 'DELETED'`];
  const params = [companyId];
  let i = 2;

  if (filters.search) {
    where.push(`(
      lead_name ILIKE $${i} OR company_name ILIKE $${i} OR
      mobile_no ILIKE $${i} OR email ILIKE $${i} OR lead_code ILIKE $${i}
    )`);
    params.push(`%${filters.search}%`); i++;
  }
  if (filters.sourceId != null) { where.push(`lead_source_id = $${i++}`); params.push(filters.sourceId); }
  if (filters.statusId != null) { where.push(`lead_status_id = $${i++}`); params.push(filters.statusId); }
  if (filters.assignedTo != null) { where.push(`assigned_to_staff_id = $${i++}`); params.push(filters.assignedTo); }
  if (filters.from) { where.push(`lead_date >= $${i++}`); params.push(filters.from); }
  if (filters.to)   { where.push(`lead_date <= $${i++}`); params.push(filters.to); }

  const { rows } = await pool.query(
    `SELECT * FROM biz.lead_master
      WHERE ${where.join(' AND ')}
      ORDER BY lead_date DESC, id DESC`,
    params
  );
  return rows.map(mapRow);
}

export async function findById(pool, companyId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM biz.lead_master
      WHERE company_id = $1 AND id = $2 AND record_status <> 'DELETED'`,
    [companyId, id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function insert(client, p) {
  const { rows } = await client.query(
    `INSERT INTO biz.lead_master
       (company_id, branch_id, lead_id, lead_code, lead_date, lead_title, lead_name,
        company_name, mobile_no, whatsapp_no, email, lead_source_id, lead_status_id,
        assigned_to_staff_id, customer_id, expected_value, probability_percent,
        next_followup_at, address, city, country, remarks,
        record_status, created_by, modified_by)
     VALUES ($1,$2,$3,$4,COALESCE($5, NOW()),$6,$7,
             $8,$9,$10,$11,$12,$13,
             $14,$15,$16,$17,
             $18,$19,$20,$21,$22,
             'ACTIVE',$23,$23)
     RETURNING *`,
    [p.companyId, p.branchId, p.leadId, p.leadCode, p.leadDate, p.leadTitle, p.leadName,
     p.companyName, p.mobileNo, p.whatsappNo, p.email, p.leadSourceId, p.leadStatusId,
     p.assignedToStaffId, p.customerId, p.expectedValue, p.probabilityPercent,
     p.nextFollowupAt, p.address, p.city, p.country, p.remarks,
     p.actorStaffId]
  );
  return mapRow(rows[0]);
}

export async function update(pool, companyId, id, p) {
  const { rows } = await pool.query(
    `UPDATE biz.lead_master SET
        lead_date = COALESCE($3, lead_date),
        lead_title = $4, lead_name = $5, company_name = $6,
        mobile_no = $7, whatsapp_no = $8, email = $9,
        lead_source_id = $10, lead_status_id = $11,
        assigned_to_staff_id = $12, customer_id = $13,
        expected_value = $14, probability_percent = $15,
        next_followup_at = $16,
        address = $17, city = $18, country = $19, remarks = $20,
        modified_by = $21, modified_at = NOW()
      WHERE company_id = $1 AND id = $2 AND record_status <> 'DELETED'
      RETURNING *`,
    [companyId, id, p.leadDate, p.leadTitle, p.leadName, p.companyName,
     p.mobileNo, p.whatsappNo, p.email,
     p.leadSourceId, p.leadStatusId,
     p.assignedToStaffId, p.customerId,
     p.expectedValue, p.probabilityPercent,
     p.nextFollowupAt,
     p.address, p.city, p.country, p.remarks,
     p.actorStaffId]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function softDelete(pool, companyId, id, actorStaffId) {
  const { rowCount } = await pool.query(
    `UPDATE biz.lead_master
        SET record_status = 'DELETED', modified_by = $3, modified_at = NOW()
      WHERE company_id = $1 AND id = $2 AND record_status <> 'DELETED'`,
    [companyId, id, actorStaffId]
  );
  return rowCount > 0;
}
