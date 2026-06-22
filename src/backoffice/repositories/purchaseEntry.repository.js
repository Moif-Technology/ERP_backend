/**
 * ops.purchase_master / ops.purchase_child */

export async function listPurchasesByBranch(pool, companyId, branchId, limit = 50, offset = 0, options = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const params = [companyId, branchId];
  let where = `WHERE p.company_id = $1
       AND p.branch_id = $2
       AND (COALESCE(TRIM(p.transaction_type), '') = '' OR UPPER(TRIM(p.transaction_type)) NOT IN ('RETURN', 'PURCHASE RETURN'))
       AND (p.record_status IS NULL OR p.record_status IN ('ACTIVE', 'CANCELLED'))`;
  if (options.dateFrom) {
    params.push(options.dateFrom);
    where += ` AND p.purchase_date >= $${params.length}::date`;
  }
  if (options.dateTo) {
    params.push(options.dateTo);
    where += ` AND p.purchase_date < ($${params.length}::date + interval '1 day')`;
  }
  params.push(lim, off);
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
     ${where}
     ORDER BY p.purchase_date DESC NULLS LAST, p.purchase_id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
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
    `SELECT COALESCE(
       MAX(
         CASE
           WHEN TRIM(purchase_no::text) ~ '^[0-9]+$' THEN TRIM(purchase_no::text)::bigint
           ELSE NULL
         END
       ),
       0
     ) + 1 AS n
     FROM ops.purchase_master
     WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId],
  );
  return String(Number(rows[0].n));
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

export async function getPurchaseMaster(pool, companyId, purchaseId) {
  const { rows } = await pool.query(
    `SELECT p.*, sm.supplier_name
     FROM ops.purchase_master p
     LEFT JOIN biz.supplier_master sm
       ON sm.company_id = p.company_id AND sm.supplier_id = p.supplier_id
     WHERE p.company_id = $1 AND p.purchase_id = $2
       AND (p.record_status IS NULL OR p.record_status IN ('ACTIVE', 'CANCELLED'))
     LIMIT 1`,
    [companyId, purchaseId],
  );
  return rows[0] || null;
}

/** Find purchase by branch + purchase_no and/or supplier invoice number. */
export async function findPurchaseByLookup(pool, companyId, branchId, { purchaseNo, supplierInvoiceNo } = {}) {
  const pno = purchaseNo != null ? String(purchaseNo).trim() : '';
  const sno = supplierInvoiceNo != null ? String(supplierInvoiceNo).trim() : '';
  if (!pno && !sno) return { kind: 'missing' };

  const params = [companyId, branchId];
  let where = `WHERE p.company_id = $1
       AND p.branch_id = $2
       AND (COALESCE(TRIM(p.transaction_type), '') = '' OR UPPER(TRIM(p.transaction_type)) NOT IN ('RETURN', 'PURCHASE RETURN'))
       AND (p.record_status IS NULL OR p.record_status IN ('ACTIVE', 'CANCELLED'))`;

  if (pno) {
    params.push(pno);
    where += ` AND TRIM(p.purchase_no::text) = $${params.length}`;
  }
  if (sno) {
    params.push(sno);
    where += ` AND TRIM(UPPER(COALESCE(p.supplier_invoice_no, ''))) = TRIM(UPPER($${params.length}))`;
  }

  const { rows } = await pool.query(
    `SELECT p.purchase_id, p.purchase_no, p.supplier_invoice_no, p.post_status, p.record_status
     FROM ops.purchase_master p
     ${where}
     ORDER BY p.purchase_id DESC
     LIMIT 5`,
    params,
  );

  if (!rows.length) return { kind: 'not_found' };
  if (rows.length > 1 && !pno) {
    return { kind: 'ambiguous', count: rows.length };
  }
  const row = rows[0];
  return {
    kind: 'found',
    purchaseId: Number(row.purchase_id),
    purchaseNo: row.purchase_no != null ? String(row.purchase_no) : '',
    supplierInvoiceNo: row.supplier_invoice_no ?? null,
    postStatus: row.post_status ?? null,
    recordStatus: row.record_status ?? null,
  };
}

export async function listPurchaseLines(pool, companyId, purchaseId) {
  const { rows } = await pool.query(
    `SELECT pc.purchase_child_id, pc.product_id, pc.own_ref_no, pc.supplier_ref_no,
            pc.qty, pc.foc_qty, pc.unit_cost, pc.unit_name,
            pc.discount_percentage, pc.discount_amount, pc.line_amount,
            pc.subtotal_amount, pc.input_tax_1_amount, pc.input_tax_1_rate,
            pm.product_code, pm.short_name, pm.product_name
     FROM ops.purchase_child pc
     LEFT JOIN core.product_master pm
       ON pm.company_id = pc.company_id AND pm.product_id = pc.product_id
     WHERE pc.company_id = $1 AND pc.purchase_id = $2
       AND (pc.record_status IS NULL OR pc.record_status = 'ACTIVE')
     ORDER BY pc.purchase_child_id`,
    [companyId, purchaseId],
  );
  return rows;
}

export async function getPurchaseChildren(client, companyId, purchaseId) {
  const { rows } = await client.query(
    `SELECT product_id, qty, foc_qty, unit_cost
     FROM ops.purchase_child
     WHERE company_id = $1 AND purchase_id = $2
       AND (record_status IS NULL OR record_status = 'ACTIVE')`,
    [companyId, purchaseId],
  );
  return rows;
}

export async function updatePurchaseMaster(client, companyId, purchaseId, branchId, row) {
  await client.query(
    `UPDATE ops.purchase_master SET
       supplier_id = $4,
       grn_id = $5,
       lpo_master_id = $6,
       purchase_date = $7,
       supplier_invoice_no = $8,
       invoice_amount = $9,
       outstanding_balance = $10,
       payment_mode = $11,
       remarks = $12,
       discount_amount = $13,
       round_off_adjustment = $14,
       subtotal_amount = $15,
       input_tax_1_amount = $16,
       input_tax_1_rate = $17,
       net_vat = $18,
       items_total_bc = $19,
       modified_by = $20,
       modified_at = NOW()
     WHERE company_id = $1 AND purchase_id = $2 AND branch_id = $3`,
    [
      companyId,
      purchaseId,
      branchId,
      row.supplierId,
      row.grnId,
      row.lpoMasterId,
      row.purchaseDate,
      row.supplierInvoiceNo,
      row.invoiceAmount,
      row.outstandingBalance,
      row.paymentMode,
      row.remarks,
      row.discountAmount ?? 0,
      row.roundOffAdjustment ?? 0,
      row.subtotalAmount,
      row.inputTax1Amount,
      row.inputTax1Rate,
      row.netVat,
      row.itemsTotalBc,
      row.modifiedBy,
    ],
  );
}

export async function softDeletePurchaseChildren(client, companyId, purchaseId) {
  await client.query(
    `UPDATE ops.purchase_child
     SET record_status = 'DELETED', modified_at = NOW()
     WHERE company_id = $1 AND purchase_id = $2`,
    [companyId, purchaseId],
  );
}

export async function updatePurchasePostStatus(client, companyId, purchaseId, branchId, postStatus) {
  await client.query(
    `UPDATE ops.purchase_master
     SET post_status = $4, modified_at = NOW()
     WHERE company_id = $1 AND purchase_id = $2 AND branch_id = $3`,
    [companyId, purchaseId, branchId, postStatus],
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
