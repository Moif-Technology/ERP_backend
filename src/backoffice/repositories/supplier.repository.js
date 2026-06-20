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
    supplierId:      Number(row.supplier_id),
    supplierCode:    row.supplier_code,
    supplierName:    row.supplier_name,
    taxRegNo:        row.supplier_tax_reg_no ?? null,
    contactPerson:   row.contact_person ?? null,
    address:         row.address ?? null,
    poBox:           row.po_box ?? null,
    city:            row.city ?? null,
    country:         row.country ?? null,
    telephone:       row.telephone ?? null,
    faxNo:           row.fax_no ?? null,
    mobileNo:        row.mobile_no ?? null,
    email:           row.email ?? null,
    paymentMode:     row.payment_mode ?? null,
    creditLimit:     row.credit_limit != null ? String(row.credit_limit) : null,
    creditBalance:   row.credit_balance != null ? String(row.credit_balance) : null,
    creditPeriodDays: row.credit_period != null ? String(row.credit_period) : null,
    remark:          row.remarks ?? null,
    recordStatus:    row.record_status,
    ledgerAccountId: row.ledger_account_id != null ? Number(row.ledger_account_id) : null,
  };
}

// With alias — for SELECT … FROM … s
const FULL_SELECT = `
  s.supplier_id, s.supplier_code, s.supplier_name,
  s.supplier_tax_reg_no, s.contact_person,
  s.address, s.po_box, s.city, s.country,
  s.telephone, s.fax_no, s.mobile_no, s.email,
  s.payment_mode, s.credit_limit, s.credit_balance, s.credit_period,
  s.remarks, s.record_status
`;

// Without alias — for UPDATE … RETURNING
const RETURNING_COLS = `
  supplier_id, supplier_code, supplier_name,
  supplier_tax_reg_no, contact_person,
  address, po_box, city, country,
  telephone, fax_no, mobile_no, email,
  payment_mode, credit_limit, credit_balance, credit_period,
  remarks, record_status
`;

export async function getSupplierById(db, companyId, supplierId) {
  const { rows } = await db.query(
    `SELECT ${FULL_SELECT}
     FROM biz.supplier_master s
     WHERE s.company_id = $1 AND s.supplier_id = $2
     LIMIT 1`,
    [companyId, supplierId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
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
    supplierId:   Number(rows[0].supplier_id),
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
    `SELECT ${FULL_SELECT},
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
        supplier_code        = $3,
        supplier_name        = $4,
        mobile_no            = $5,
        email                = $6,
        supplier_tax_reg_no  = $7,
        contact_person       = $8,
        address              = $9,
        po_box               = $10,
        city                 = $11,
        country              = $12,
        telephone            = $13,
        fax_no               = $14,
        payment_mode         = $15,
        credit_limit         = $16,
        credit_balance       = $17,
        credit_period        = $18,
        remarks              = $19,
        modified_by          = $20,
        modified_at          = NOW()
     WHERE company_id = $1 AND supplier_id = $2
     RETURNING ${RETURNING_COLS}`,
    [
      companyId, supplierId,
      params.supplierCode, params.supplierName, params.mobileNo, params.email,
      params.taxRegNo, params.contactPerson,
      params.address, params.poBox, params.city, params.country,
      params.telephone, params.faxNo,
      params.paymentMode, params.creditLimit, params.creditBalance, params.creditPeriodDays,
      params.remark,
      params.modifiedBy,
    ]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function insertSupplier(client, row) {
  await client.query(
    `INSERT INTO biz.supplier_master (
       company_id, supplier_id, supplier_code, supplier_name,
       mobile_no, email,
       supplier_tax_reg_no, contact_person,
       address, po_box, city, country,
       telephone, fax_no,
       payment_mode, credit_limit, credit_balance, credit_period,
       remarks,
       record_status, created_by, modified_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
     )`,
    [
      row.companyId,
      row.supplierId,
      row.supplierCode,
      row.supplierName,
      row.mobileNo,
      row.email,
      row.taxRegNo,
      row.contactPerson,
      row.address,
      row.poBox,
      row.city,
      row.country,
      row.telephone,
      row.faxNo,
      row.paymentMode,
      row.creditLimit    ?? 0,
      row.creditBalance  ?? 0,
      row.creditPeriodDays ?? 0,
      row.remark,
      row.recordStatus || 'ACTIVE',
      row.createdBy,
      row.modifiedBy,
    ],
  );
}
