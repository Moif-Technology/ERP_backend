/**
 * ops.quotation_master, ops.quotation_child; numbering via core.document_sequence
 */

/** MOIFONE INDEXES: sequence_code examples use snake_case (sales_invoice, grn). */
export const QUOTATION_SEQUENCE_CODE = 'quotation';

/**
 * Next display number from core.document_sequence (company_id + branch_id + sequence_code).
 * Uses current_value as last-issued number; increments by step_value (default 1).
 * Serialized with pg_advisory_xact_lock so concurrent saves never collide.
 */
export async function nextQuotationSequenceNumber(client, companyId, branchId, { createdBy = 'system' } = {}) {
  const actor = String(createdBy || 'system').slice(0, 50);
  const lockKey = `core.docseq:${companyId}:${branchId}:${QUOTATION_SEQUENCE_CODE}`;
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [lockKey]);

  const sel = await client.query(
    `SELECT id, current_value, step_value, prefix
     FROM core.document_sequence
     WHERE company_id = $1
       AND branch_id = $2
       AND sequence_code = $3
       AND is_active IS TRUE
     FOR UPDATE`,
    [companyId, branchId, QUOTATION_SEQUENCE_CODE],
  );

  let next;
  let prefix;

  if (sel.rows.length === 0) {
    next = 1;
    prefix = 'QTN';
    await client.query(
      `INSERT INTO core.document_sequence (
         company_id, branch_id, sequence_code, sequence_name,
         current_value, step_value, prefix, is_active,
         created_on, modified_on, created_by, modified_by
       ) VALUES ($1, $2, $3, $4, $5, 1, $6, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $7, $7)`,
      [companyId, branchId, QUOTATION_SEQUENCE_CODE, 'Quotation', next, prefix, actor],
    );
  } else {
    const row = sel.rows[0];
    const step = Number(row.step_value) >= 1 ? Number(row.step_value) : 1;
    next = Number(row.current_value) + step;
    const rawPrefix = row.prefix != null ? String(row.prefix).trim() : '';
    prefix = rawPrefix !== '' ? rawPrefix : 'QTN';
    await client.query(
      `UPDATE core.document_sequence
       SET current_value = $1, modified_on = CURRENT_TIMESTAMP, modified_by = $2
       WHERE id = $3`,
      [next, actor, row.id],
    );
  }

  return { seqNum: next, prefix };
}

/** Builds quotation_no from sequence row prefix + padded numeric (e.g. QTN-000042). */
export function formatQuotationNo(seq, prefix = 'QTN') {
  const p = String(prefix || 'QTN')
    .replace(/-+$/g, '')
    .trim() || 'QTN';
  const n = Number(seq);
  if (!Number.isFinite(n) || n < 1) return `${p}-000001`;
  return `${p}-${String(n).padStart(6, '0')}`;
}

export async function nextQuotationId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(quotation_id), 0) + 1 AS n
     FROM ops.quotation_master WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].n);
}

export async function nextQuotationChildId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(quotation_child_id), 0) + 1 AS n
     FROM ops.quotation_child WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].n);
}

export async function insertQuotationMaster(client, row) {
  const {
    companyId,
    quotationId,
    branchId,
    quotationNo,
    quotationDate,
    customerRefNo,
    customerRefDate,
    staffId,
    quotationStatus,
    customerId,
    customerName,
    customerAddress,
    contactPerson,
    quotationAmount,
    discountAmount,
    quotationTerms,
    remarks,
    recordStatus,
    postStatus,
    prefix,
    quotationNoNumeric,
    subtotalAmount,
    taxableAmount,
    tax1Amount,
    tax2Amount,
    tax3Amount,
    tax1Rate,
    tax2Rate,
    tax3Rate,
    roundOffAdjustment,
    createdBy,
    modifiedBy,
    createdByStaffId,
  } = row;

  await client.query(
    `INSERT INTO ops.quotation_master (
 company_id, quotation_id, branch_id, quotation_no, quotation_date,
        customer_ref_no, customer_ref_date, staff_id, quotation_status,
        customer_id, customer_name, customer_address, contact_person,
        quotation_amount, discount_amount, quotation_terms, remarks,
        record_status, post_status, prefix, quotation_no_numeric,
        subtotal_amount, taxable_amount,
        tax_1_amount, tax_2_amount, tax_3_amount,
        tax_1_rate, tax_2_rate, tax_3_rate,
        round_off_adjustment,
        created_by, modified_by, created_by_staff_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33
      )`,
    [
      companyId,
      quotationId,
      branchId,
      quotationNo,
      quotationDate,
      customerRefNo,
      customerRefDate,
      staffId,
      quotationStatus,
      customerId,
      customerName,
      customerAddress,
      contactPerson,
      quotationAmount,
      discountAmount,
      quotationTerms,
      remarks,
      recordStatus,
      postStatus,
      prefix,
      quotationNoNumeric,
      subtotalAmount,
      taxableAmount,
      tax1Amount,
      tax2Amount,
      tax3Amount,
      tax1Rate,
      tax2Rate,
      tax3Rate,
      roundOffAdjustment,
      createdBy,
      modifiedBy,
      createdByStaffId ?? null,
    ],
  );
}

export async function updateQuotationMaster(client, row) {
  const {
    companyId,
    quotationId,
    quotationDate,
    customerRefNo,
    customerRefDate,
    staffId,
    customerId,
    customerName,
    customerAddress,
    contactPerson,
    quotationAmount,
    discountAmount,
    quotationTerms,
    remarks,
    subtotalAmount,
    taxableAmount,
    tax1Amount,
    tax2Amount,
    tax3Amount,
    tax1Rate,
    tax2Rate,
    tax3Rate,
    roundOffAdjustment,
    modifiedBy,
  } = row;

  const { rowCount } = await client.query(
    `UPDATE ops.quotation_master SET
        quotation_date = $3,
        customer_ref_no = $4,
        customer_ref_date = $5,
        staff_id = $6,
        customer_id = $7,
        customer_name = $8,
        customer_address = $9,
        contact_person = $10,
        quotation_amount = $11,
        discount_amount = $12,
        quotation_terms = $13,
        remarks = $14,
        subtotal_amount = $15,
        taxable_amount = $16,
        tax_1_amount = $17,
        tax_2_amount = $18,
        tax_3_amount = $19,
        tax_1_rate = $20,
        tax_2_rate = $21,
        tax_3_rate = $22,
        round_off_adjustment = $23,
        modified_by = $24,
        modified_at = CURRENT_TIMESTAMP
     WHERE company_id = $1 AND quotation_id = $2
       AND COALESCE(post_status, 'UNPOSTED') = 'UNPOSTED'
       AND COALESCE(is_deleted, FALSE) = FALSE`,
    [
      companyId,
      quotationId,
      quotationDate,
      customerRefNo,
      customerRefDate,
      staffId,
      customerId,
      customerName,
      customerAddress,
      contactPerson,
      quotationAmount,
      discountAmount,
      quotationTerms,
      remarks,
      subtotalAmount,
      taxableAmount,
      tax1Amount,
      tax2Amount,
      tax3Amount,
      tax1Rate,
      tax2Rate,
      tax3Rate,
      roundOffAdjustment,
      modifiedBy,
    ],
  );
  return rowCount;
}

export async function deleteQuotationChildren(client, companyId, quotationId) {
  await client.query(
    `DELETE FROM ops.quotation_child
     WHERE company_id = $1 AND quotation_id = $2`,
    [companyId, quotationId],
  );
}

export async function insertQuotationChild(client, row) {
  const {
    companyId,
    quotationChildId,
    quotationId,
    productId,
    barcode,
    productDescription,
    unitName,
    qty,
    unitPrice,
    itemDiscount,
    locationCode,
    recordStatus,
    postStatus,
    tax1Amount,
    tax2Amount,
    tax3Amount,
    tax1Rate,
    tax2Rate,
    tax3Rate,
    subtotalAmount,
    lineTotal,
    originName,
    stockStatus,
    createdBy,
    modifiedBy,
  } = row;

  await client.query(
    `INSERT INTO ops.quotation_child (
        company_id, quotation_child_id, quotation_id, product_id,
        barcode, product_description, unit_name, qty, unit_price, item_discount,
        location_code, record_status, post_status,
        tax_1_amount, tax_2_amount, tax_3_amount,
        tax_1_rate, tax_2_rate, tax_3_rate,
        subtotal_amount, line_total, origin_name, stock_status,
        created_by, modified_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
      )`,
    [
      companyId,
      quotationChildId,
      quotationId,
      productId,
      barcode,
      productDescription,
      unitName,
      qty,
      unitPrice,
      itemDiscount,
      locationCode,
      recordStatus,
      postStatus,
      tax1Amount,
      tax2Amount,
      tax3Amount,
      tax1Rate,
      tax2Rate,
      tax3Rate,
      subtotalAmount,
      lineTotal,
      originName,
      stockStatus,
      createdBy,
      modifiedBy,
    ],
  );
}

export async function findCustomerForQuotation(pool, companyId, customerId) {
  const { rows } = await pool.query(
    `SELECT customer_id, customer_name, address, contact_person
     FROM biz.customer_master
     WHERE company_id = $1 AND customer_id = $2
       AND (status IS NULL OR status = 'ACTIVE')
     LIMIT 1`,
    [companyId, customerId],
  );
  return rows[0] || null;
}

export async function findProductLineForQuotation(pool, companyId, branchId, productId) {
  const { rows } = await pool.query(
    `SELECT m.product_id, m.product_code, m.barcode, m.short_name, m.product_name, m.unit_name,
            i.location_code
     FROM core.product_master m
     INNER JOIN core.product_inventory i
       ON m.company_id = i.company_id AND m.product_id = i.product_id
     WHERE m.company_id = $1
       AND i.branch_id = $2
       AND m.product_id = $3
       AND m.record_status = 'ACTIVE'
       AND i.record_status = 'ACTIVE'
     LIMIT 1`,
    [companyId, branchId, productId],
  );
  return rows[0] || null;
}

export async function getQuotationByBusinessId(pool, companyId, quotationId) {
  const { rows: masters } = await pool.query(
    `SELECT *
     FROM ops.quotation_master
     WHERE company_id = $1 AND quotation_id = $2
     LIMIT 1`,
    [companyId, quotationId],
  );
  if (!masters.length) return null;
  const { rows: children } = await pool.query(
    `SELECT *
     FROM ops.quotation_child
     WHERE company_id = $1 AND quotation_id = $2
     ORDER BY id ASC`,
    [companyId, quotationId],
  );
  return { master: masters[0], children };
}

export async function listQuotations(pool, companyId, branchId, limit, offset, { excludeInvoiced = false } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const invoiceFilter = excludeInvoiced
    ? `AND NOT EXISTS (
         SELECT 1 FROM core.document_reference_map dr
         WHERE dr.company_id = q.company_id
           AND dr.reference_doc_id = q.quotation_id
           AND dr.reference_doc_type = 'QU'
           AND dr.source_doc_type = 'SL'
       )`
    : '';
  const { rows } = await pool.query(
    `SELECT q.quotation_id, q.branch_id, q.quotation_no, q.quotation_date,
            q.customer_ref_no, q.customer_ref_date, q.customer_id, q.customer_name,
            q.quotation_amount, q.quotation_status, q.record_status, q.discount_amount, q.round_off_adjustment
     FROM ops.quotation_master q
     WHERE q.company_id = $1 AND q.branch_id = $2 AND (q.record_status IS NULL OR q.record_status = 'ACTIVE')
     ${invoiceFilter}
     ORDER BY q.quotation_date DESC, q.quotation_id DESC
     LIMIT $3 OFFSET $4`,
    [companyId, branchId, lim, off],
  );
  return rows;
}
