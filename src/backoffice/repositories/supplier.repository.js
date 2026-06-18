/**
 * biz.supplier_master (company scoped).
 */

export async function nextSupplierId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(supplier_id), 0) + 1 AS next_id
     FROM biz.supplier_master WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].next_id);
}

export async function countActiveSuppliers(db, companyId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM biz.supplier_master
     WHERE company_id = $1
       AND COALESCE(record_status, 'ACTIVE') = 'ACTIVE'`,
    [companyId]
  );
  return Number(rows[0]?.n || 0);
}

function mapRow(row) {
  return {
    supplierId: Number(row.supplier_id),
    supplierCode: row.supplier_code,
    supplierName: row.supplier_name,
    mobileNo: row.mobile_no ?? null,
    email: row.email ?? null,
    recordStatus: row.record_status,
  };
}

export async function findSupplierById(db, companyId, supplierId) {
  const { rows } = await db.query(
    `SELECT supplier_id, supplier_code, supplier_name
     FROM biz.supplier_master
     WHERE company_id = $1 AND supplier_id = $2
     LIMIT 1`,
    [companyId, supplierId],
  );
  if (!rows[0]) return null;
  return {
    supplierId: Number(rows[0].supplier_id),
    supplierCode: rows[0].supplier_code,
    supplierName: rows[0].supplier_name,
  };
}

export async function supplierExists(pool, companyId, supplierId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM biz.supplier_master
     WHERE company_id = $1 AND supplier_id = $2 AND record_status = 'ACTIVE'
     LIMIT 1`,
    [companyId, supplierId],
  );
  return rows.length > 0;
}

export async function listSuppliers(pool, companyId, limit = 500) {
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const { rows } = await pool.query(
    `SELECT supplier_id, supplier_code, supplier_name, mobile_no, email, record_status
     FROM biz.supplier_master
     WHERE company_id = $1 AND record_status = 'ACTIVE'
     ORDER BY supplier_name
     LIMIT $2`,
    [companyId, lim],
  );
  return rows.map(mapRow);
}

export async function updateSupplier(db, companyId, supplierId, params) {
  const { rows } = await db.query(
    `UPDATE biz.supplier_master SET
        supplier_code = $3, supplier_name = $4, mobile_no = $5, email = $6,
        modified_by = $7, modified_on = NOW()
     WHERE company_id = $1 AND supplier_id = $2
     RETURNING supplier_id, supplier_code, supplier_name, mobile_no, email, record_status`,
    [companyId, supplierId, params.supplierCode, params.supplierName, params.mobileNo, params.email, params.modifiedBy]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function insertSupplier(client, row) {
  await client.query(
    `INSERT INTO biz.supplier_master (
       company_id, supplier_id, supplier_code, supplier_name,
       mobile_no, email, record_status, created_by, modified_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      row.companyId,
      row.supplierId,
      row.supplierCode,
      row.supplierName,
      row.mobileNo,
      row.email,
      row.recordStatus || 'ACTIVE',
      row.createdBy,
      row.modifiedBy,
    ],
  );
}
