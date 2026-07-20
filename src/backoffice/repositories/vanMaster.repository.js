/**
 * Data access for ops.van_master (company scoped).
 */

export async function nextVanId(db, companyId) {
  const { rows } = await db.query(
    `SELECT COALESCE(MAX(van_id), 0) + 1 AS next_id
     FROM ops.van_master
     WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].next_id);
}

export async function listVans(db, companyId) {
  const { rows } = await db.query(
    `SELECT id, company_id, branch_id, van_id, van_code, van_name, plate_no,
            is_active, created_at, created_by, modified_at, modified_by
     FROM ops.van_master
     WHERE company_id = $1
     ORDER BY van_id ASC`,
    [companyId]
  );
  return rows.map(mapRow);
}

export async function findVan(db, companyId, vanId) {
  const { rows } = await db.query(
    `SELECT id, company_id, branch_id, van_id, van_code, van_name, plate_no,
            is_active, created_at, created_by, modified_at, modified_by
     FROM ops.van_master
     WHERE company_id = $1 AND van_id = $2
     LIMIT 1`,
    [companyId, vanId]
  );
  if (!rows[0]) return null;
  return mapRow(rows[0]);
}

export async function insertVan(db, params) {
  const { companyId, branchId, vanId, vanCode, vanName, plateNo, actor } = params;
  const { rows } = await db.query(
    `INSERT INTO ops.van_master
       (company_id, branch_id, van_id, van_code, van_name, plate_no,
        is_active, created_at, created_by, modified_at, modified_by)
     VALUES ($1, $2, $3, $4, $5, $6,
             TRUE, NOW(), $7, NOW(), $7)
     RETURNING id, company_id, branch_id, van_id, van_code, van_name, plate_no,
               is_active, created_at, created_by, modified_at, modified_by`,
    [companyId, branchId, vanId, vanCode, vanName, plateNo ?? null, actor]
  );
  return mapRow(rows[0]);
}

export async function updateVan(db, params) {
  const { companyId, vanId, vanCode, vanName, plateNo, actor } = params;
  const { rows } = await db.query(
    `UPDATE ops.van_master
     SET van_code = $3, van_name = $4, plate_no = $5,
         modified_at = NOW(), modified_by = $6
     WHERE company_id = $1 AND van_id = $2
     RETURNING id, company_id, branch_id, van_id, van_code, van_name, plate_no,
               is_active, created_at, created_by, modified_at, modified_by`,
    [companyId, vanId, vanCode, vanName, plateNo ?? null, actor]
  );
  if (!rows[0]) return null;
  return mapRow(rows[0]);
}

export async function toggleVanActive(db, companyId, vanId, isActive, actor) {
  const { rows } = await db.query(
    `UPDATE ops.van_master
     SET is_active = $3, modified_at = NOW(), modified_by = $4
     WHERE company_id = $1 AND van_id = $2
     RETURNING id, company_id, branch_id, van_id, van_code, van_name, plate_no,
               is_active, created_at, created_by, modified_at, modified_by`,
    [companyId, vanId, isActive, actor]
  );
  if (!rows[0]) return null;
  return mapRow(rows[0]);
}

function mapRow(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    branchId: row.branch_id != null ? Number(row.branch_id) : null,
    vanId: Number(row.van_id),
    vanCode: row.van_code,
    vanName: row.van_name,
    plateNo: row.plate_no ?? null,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at ?? null,
    createdBy: row.created_by ?? null,
    modifiedAt: row.modified_at ?? null,
    modifiedBy: row.modified_by ?? null,
  };
}
