/**
 * ops.lpo_master / ops.lpo_child — procurement LPO (MOIFONE ops.lpo_master).
 */

/** Legacy `own_ref_no` is numeric and NOT NULL in the live MOIFONE schema. */
function ownRefForDb(v) {
  const digits = String(v ?? '').replace(/\D/g, '').slice(0, 18);
  return digits.length ? digits : '0';
}

export async function nextLpoMasterId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(lpo_master_id), 0) + 1 AS n FROM ops.lpo_master WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].n);
}

export async function nextLpoChildId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(lpo_child_id), 0) + 1 AS n FROM ops.lpo_child WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].n);
}

export async function listLposByBranch(pool, companyId, branchId, limit = 200) {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const { rows } = await pool.query(
    `SELECT lpo_master_id, branch_id, lpo_no, lpo_date, supplier_id, lpo_amount, status, record_status
     FROM ops.lpo_master
     WHERE company_id = $1 AND branch_id = $2
       AND (record_status IS NULL OR record_status = 'ACTIVE')
     ORDER BY lpo_date DESC NULLS LAST, lpo_master_id DESC
     LIMIT $3`,
    [companyId, branchId, lim],
  );
  return rows;
}

/** @param {import('pg').Pool | import('pg').PoolClient} conn */
export async function getLpoWithLines(conn, companyId, lpoMasterId) {
  const { rows: masters } = await conn.query(
    `SELECT * FROM ops.lpo_master WHERE company_id = $1 AND lpo_master_id = $2 LIMIT 1`,
    [companyId, lpoMasterId],
  );
  if (!masters.length) return null;
  const { rows: children } = await conn.query(
    `SELECT * FROM ops.lpo_child
     WHERE company_id = $1 AND lpo_master_id = $2
     ORDER BY id ASC`,
    [companyId, lpoMasterId],
  );
  return { master: masters[0], children };
}

export async function insertLpoMaster(client, row) {
  await client.query(
    `INSERT INTO ops.lpo_master (
       company_id, lpo_master_id, branch_id, lpo_no, lpo_date, supplier_id,
       lpo_amount, discount_amount, sub_total, status, record_status,
       order_form_no, supplier_display_name, supplier_quotation_no, discount_mode,
       by_supplier, list_items, use_disc_pct, lpo_terms,
       created_by, modified_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
     )`,
    [
      row.companyId,
      row.lpoMasterId,
      row.branchId,
      row.lpoNo,
      row.lpoDate,
      row.supplierId,
      row.lpoAmount,
      row.discountAmount,
      row.subTotal,
      row.status || 'DRAFT',
      row.recordStatus || 'ACTIVE',
      row.orderFormNo,
      row.supplierDisplayName,
      row.supplierQuotationNo,
      row.discountMode,
      row.bySupplier,
      row.listItems,
      row.useDiscPct,
      row.lpoTerms ?? '',
      row.createdBy ?? 0,
      row.modifiedBy ?? 0,
    ],
  );
}

export async function insertLpoChild(client, row) {
  /** Legacy Moifone schema: discount, sub_total, input_tax_1_* (no item_discount / subtotal_amount / line_total). */
  await client.query(
    `INSERT INTO ops.lpo_child (
       company_id, branch_id, lpo_child_id, lpo_master_id, product_id,
       qty, unit_price, discount, sub_total, uom, barcode, description,
       foc_qty, pack_qty, own_ref_no, base_cost, disc_percent, vat_percent, vat_amount,
       input_tax_1_amount, input_tax_1_rate,
       record_status, created_by, modified_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
     )`,
    [
      row.companyId,
      row.branchId,
      row.lpoChildId,
      row.lpoMasterId,
      row.productId,
      row.qty,
      row.unitPrice,
      row.itemDiscount,
      row.subtotalAmount,
      row.uom,
      row.barcode ?? '',
      row.description ?? '',
      row.focQty,
      row.packQty,
      ownRefForDb(row.ownRefNo),
      row.baseCost,
      row.discPercent,
      row.vatPercent,
      row.vatAmount,
      row.vatAmount,
      row.vatPercent,
      row.recordStatus || 'ACTIVE',
      row.createdBy ?? 0,
      row.modifiedBy ?? 0,
    ],
  );
}

export async function deleteLpoChildren(client, companyId, lpoMasterId) {
  await client.query(
    `DELETE FROM ops.lpo_child WHERE company_id = $1 AND lpo_master_id = $2`,
    [companyId, lpoMasterId],
  );
}

export async function updateLpoMaster(client, companyId, lpoMasterId, row) {
  await client.query(
    `UPDATE ops.lpo_master SET
       lpo_no = $3,
       lpo_date = $4,
       supplier_id = $5,
       lpo_amount = $6,
       discount_amount = $7,
       sub_total = $8,
       status = $9,
       modified_at = CURRENT_TIMESTAMP,
       order_form_no = $10,
       supplier_display_name = $11,
       supplier_quotation_no = $12,
       discount_mode = $13,
       by_supplier = $14,
       list_items = $15,
       use_disc_pct = $16,
       lpo_terms = $17
     WHERE company_id = $1 AND lpo_master_id = $2`,
    [
      companyId,
      lpoMasterId,
      row.lpoNo,
      row.lpoDate,
      row.supplierId,
      row.lpoAmount,
      row.discountAmount,
      row.subTotal,
      row.status || 'DRAFT',
      row.orderFormNo,
      row.supplierDisplayName,
      row.supplierQuotationNo,
      row.discountMode,
      row.bySupplier,
      row.listItems,
      row.useDiscPct,
      row.lpoTerms,
    ],
  );
}
