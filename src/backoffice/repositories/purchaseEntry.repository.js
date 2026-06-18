/**
 * ops.purchase_master / ops.purchase_child */

export async function listPurchasesByBranch(pool, companyId, branchId, limit = 50, offset = 0) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const { rows } = await pool.query(
    `SELECT p.purchase_id, p.branch_id, p.supplier_id, sm.supplier_name,
            p.grn_id, p.lpo_master_id,
            p.purchase_date, p.purchase_no, p.supplier_invoice_no,
            p.invoice_amount, p.outstanding_balance, p.payment_mode, p.post_status, p.remarks,
            p.subtotal_amount, p.input_tax_1_amount, p.net_vat, p.items_total_bc,
            p.record_status
     FROM ops.purchase_master p
     LEFT JOIN biz.supplier_master sm
       ON sm.company_id = p.company_id AND sm.supplier_id = p.supplier_id
     WHERE p.company_id = $1
       AND p.branch_id = $2
       AND (p.record_status IS NULL OR p.record_status = 'ACTIVE')
     ORDER BY p.purchase_date DESC NULLS LAST, p.purchase_id DESC
     LIMIT $3 OFFSET $4`,
    [companyId, branchId, lim, off],
  );
  return rows;
}

export async function nextPurchaseId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(purchase_id), 0) + 1 AS n FROM ops.purchase_master WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].n);
}

export async function nextPurchaseChildId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(purchase_child_id), 0) + 1 AS n FROM ops.purchase_child WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].n);
}

export async function nextPurchaseNo(client, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(purchase_no), 0) + 1 AS n
     FROM ops.purchase_master
     WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId],
  );
  return Number(rows[0].n);
}

export async function insertPurchaseMaster(client, row) {
  await client.query(
    `INSERT INTO ops.purchase_master (
       company_id, purchase_id, branch_id, supplier_id, grn_id, lpo_master_id,
       purchase_date, purchase_no, supplier_invoice_no,
       invoice_amount, outstanding_balance, payment_mode, post_status,
       discount_amount, round_off_adjustment, remarks,
       subtotal_amount, input_tax_1_amount, input_tax_2_amount, input_tax_3_amount,
       input_tax_1_rate, input_tax_2_rate, input_tax_3_rate,
       net_vat, items_total_bc, currency_rate,
       record_status, created_by, modified_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
     )`,
    [
      row.companyId,
      row.purchaseId,
      row.branchId,
      row.supplierId,
      row.grnId,
      row.lpoMasterId,
      row.purchaseDate,
      row.purchaseNo,
      row.supplierInvoiceNo,
      row.invoiceAmount,
      row.outstandingBalance,
      row.paymentMode,
      row.postStatus,
      row.discountAmount,
      row.roundOffAdjustment,
      row.remarks,
      row.subtotalAmount,
      row.inputTax1Amount,
      row.inputTax2Amount,
      row.inputTax3Amount,
      row.inputTax1Rate,
      row.inputTax2Rate,
      row.inputTax3Rate,
      row.netVat,
      row.itemsTotalBc,
      row.currencyRate,
      row.recordStatus || 'ACTIVE',
      row.createdBy,
      row.modifiedBy,
    ],
  );
}

export async function insertPurchaseChild(client, row) {
  await client.query(
    `INSERT INTO ops.purchase_child (
       company_id, purchase_child_id, purchase_id, branch_id, product_id,
       own_ref_no, supplier_ref_no,
       pack_qty, qty, unit_cost, unit_name, foc_qty, foc_amount,
       discount_percentage, discount_amount, line_amount, subtotal_amount,
       input_tax_1_amount, input_tax_1_rate, input_tax_2_amount, input_tax_3_amount,
       input_tax_2_rate, input_tax_3_rate, currency_rate, unit_cost_bc,
       record_status, created_by, modified_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
     )`,
    [
      row.companyId,
      row.purchaseChildId,
      row.purchaseId,
      row.branchId,
      row.productId,
      row.ownRefNo,
      row.supplierRefNo,
      row.packQty,
      row.qty,
      row.unitCost,
      row.unitName,
      row.focQty,
      row.focAmount,
      row.discountPercentage,
      row.discountAmount,
      row.lineAmount,
      row.subtotalAmount,
      row.inputTax1Amount,
      row.inputTax1Rate,
      row.inputTax2Amount,
      row.inputTax3Amount,
      row.inputTax2Rate,
      row.inputTax3Rate,
      row.currencyRate,
      row.unitCostBc,
      row.recordStatus || 'ACTIVE',
      row.createdBy,
      row.modifiedBy,
    ],
  );
}
