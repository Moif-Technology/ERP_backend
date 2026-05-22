/** Data access for biz.lead_status_master (company scoped). */

function mapRow(r) {
  return {
    id: Number(r.id),
    statusId: Number(r.lead_status_id),
    statusCode: r.status_code,
    statusName: r.status_name,
    statusType: r.status_type,
    isFinalStatus: !!r.is_final_status,
    isActive: !!r.is_active,
    displayOrder: r.display_order != null ? Number(r.display_order) : 0,
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
  };
}

export async function nextStatusId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(lead_status_id), 0) + 1 AS n
       FROM biz.lead_status_master WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].n);
}

export async function listByCompany(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT * FROM biz.lead_status_master
      WHERE company_id = $1
      ORDER BY display_order ASC, status_name ASC`,
    [companyId]
  );
  return rows.map(mapRow);
}

export async function insert(client, p) {
  const { rows } = await client.query(
    `INSERT INTO biz.lead_status_master
       (company_id, lead_status_id, status_code, status_name, status_type,
        is_final_status, is_active, display_order,
        created_by, modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
     RETURNING *`,
    [p.companyId, p.statusId, p.statusCode, p.statusName, p.statusType,
     p.isFinalStatus, p.isActive, p.displayOrder, p.actorStaffId]
  );
  return mapRow(rows[0]);
}

export async function update(client, companyId, id, p) {
  const { rows } = await client.query(
    `UPDATE biz.lead_status_master SET
        status_code = $3, status_name = $4, status_type = $5,
        is_final_status = $6, is_active = $7, display_order = $8,
        modified_by = $9, modified_at = NOW()
      WHERE company_id = $1 AND id = $2
      RETURNING *`,
    [companyId, id, p.statusCode, p.statusName, p.statusType,
     p.isFinalStatus, p.isActive, p.displayOrder, p.actorStaffId]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function remove(client, companyId, id) {
  const { rowCount } = await client.query(
    `DELETE FROM biz.lead_status_master WHERE company_id = $1 AND id = $2`,
    [companyId, id]
  );
  return rowCount > 0;
}
