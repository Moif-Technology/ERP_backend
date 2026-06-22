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
    paymentMode: row.payment_mode ?? null,
    recordStatus: row.record_status,
    ledgerAccountId: row.ledger_account_id != null ? Number(row.ledger_account_id) : null,
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
    `SELECT s.supplier_id, s.supplier_code, s.supplier_name, s.mobile_no, s.email,
            s.payment_mode, s.record_status,
            ah.account_id AS ledger_account_id
     FROM biz.supplier_master s
     LEFT JOIN accounts.account_head_master ah
       ON ah.company_id = s.company_id
      AND ah.account_no = s.supplier_code
      AND (ah.record_status IS NULL OR TRIM(UPPER(ah.record_status)) = 'ACTIVE')
     WHERE s.company_id = $1 AND s.record_status = 'ACTIVE'
     ORDER BY s.supplier_name
     LIMIT $2`,
    [companyId, lim],
  );
  return rows.map(mapRow);
}

export async function updateSupplier(db, companyId, supplierId, params) {
  const { rows } = await db.query(
    `UPDATE biz.supplier_master SET
        supplier_code = $3, supplier_name = $4, mobile_no = $5, email = $6,
        payment_mode = $8,
        modified_by = $7, modified_at = NOW()
     WHERE company_id = $1 AND supplier_id = $2
     RETURNING supplier_id, supplier_code, supplier_name, mobile_no, email, payment_mode, record_status`,
    [companyId, supplierId, params.supplierCode, params.supplierName, params.mobileNo, params.email, params.modifiedBy, params.paymentMode]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function insertSupplier(client, row) {
  await client.query(
    `INSERT INTO biz.supplier_master (
       company_id, supplier_id, supplier_code, supplier_name,
       mobile_no, email, payment_mode, record_status, created_by, modified_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      row.companyId,
      row.supplierId,
      row.supplierCode,
      row.supplierName,
      row.mobileNo,
      row.email,
      row.paymentMode,
      row.recordStatus || 'ACTIVE',
      row.createdBy,
      row.modifiedBy,
    ],
  );
}
