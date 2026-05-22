/** Data access for biz.lead_source_master (company scoped). */

function mapRow(r) {
  return {
    id: Number(r.id),
    sourceId: Number(r.lead_source_id),
    sourceCode: r.source_code,
    sourceName: r.source_name,
    description: r.source_description ?? null,
    isActive: !!r.is_active,
    displayOrder: r.display_order != null ? Number(r.display_order) : 0,
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
  };
}

export async function nextSourceId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(lead_source_id), 0) + 1 AS n
       FROM biz.lead_source_master WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].n);
}

export async function listByCompany(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT * FROM biz.lead_source_master
      WHERE company_id = $1
      ORDER BY display_order ASC, source_name ASC`,
    [companyId]
  );
  return rows.map(mapRow);
}

export async function insert(client, p) {
  const { rows } = await client.query(
    `INSERT INTO biz.lead_source_master
       (company_id, lead_source_id, source_code, source_name, source_description,
        is_active, display_order, created_by, modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     RETURNING *`,
    [p.companyId, p.sourceId, p.sourceCode, p.sourceName, p.description,
     p.isActive, p.displayOrder, p.actorStaffId]
  );
  return mapRow(rows[0]);
}

export async function update(client, companyId, id, p) {
  const { rows } = await client.query(
    `UPDATE biz.lead_source_master SET
        source_code = $3, source_name = $4, source_description = $5,
        is_active = $6, display_order = $7,
        modified_by = $8, modified_at = NOW()
      WHERE company_id = $1 AND id = $2
      RETURNING *`,
    [companyId, id, p.sourceCode, p.sourceName, p.description,
     p.isActive, p.displayOrder, p.actorStaffId]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function remove(client, companyId, id) {
  const { rowCount } = await client.query(
    `DELETE FROM biz.lead_source_master WHERE company_id = $1 AND id = $2`,
    [companyId, id]
  );
  return rowCount > 0;
}
