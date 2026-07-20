/** Data access for service.category_master (company scoped, soft-delete via record_status). */

function mapRow(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    categoryId: Number(r.category_id),
    categoryName: r.category_name,
    description: r.description,
    sortOrder: Number(r.sort_order),
    recordStatus: r.record_status,
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
  };
}

export async function nextCategoryId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(category_id), 0) + 1 AS n
       FROM service.category_master WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].n);
}

export async function listByCompany(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT * FROM service.category_master
      WHERE company_id = $1 AND record_status <> 'DELETED'
      ORDER BY sort_order, category_name`,
    [companyId]
  );
  return rows.map(mapRow);
}

export async function findById(pool, companyId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM service.category_master
      WHERE company_id = $1 AND id = $2 AND record_status <> 'DELETED'`,
    [companyId, id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function insert(client, p) {
  const { rows } = await client.query(
    `INSERT INTO service.category_master
       (company_id, category_id, category_name, description, sort_order,
        record_status, created_by, modified_by)
     VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$6)
     RETURNING *`,
    [p.companyId, p.categoryId, p.categoryName, p.description, p.sortOrder, p.actorStaffId]
  );
  return mapRow(rows[0]);
}

export async function update(pool, companyId, id, p) {
  const { rows } = await pool.query(
    `UPDATE service.category_master SET
        category_name = $3, description = $4, sort_order = $5,
        modified_by = $6, modified_at = NOW()
      WHERE company_id = $1 AND id = $2 AND record_status <> 'DELETED'
      RETURNING *`,
    [companyId, id, p.categoryName, p.description, p.sortOrder, p.actorStaffId]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function softDelete(pool, companyId, id, actorStaffId) {
  const { rowCount } = await pool.query(
    `UPDATE service.category_master
        SET record_status = 'DELETED', modified_by = $3, modified_at = NOW()
      WHERE company_id = $1 AND id = $2 AND record_status <> 'DELETED'`,
    [companyId, id, actorStaffId]
  );
  return rowCount > 0;
}

export async function hasActiveServices(pool, companyId, categoryId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM service.service_master
      WHERE company_id = $1 AND category_id = $2 AND record_status <> 'DELETED' LIMIT 1`,
    [companyId, categoryId]
  );
  return rows.length > 0;
}
