/**
 * Purchase return — reuses ops.purchase_master / ops.purchase_child with transaction_type = 'RETURN'.
 */
import * as purchaseEntryRepo from './purchaseEntry.repository.js';

const RETURN_TYPE = 'RETURN';

function returnTypeFilter(alias = 'p') {
  return `UPPER(COALESCE(TRIM(${alias}.transaction_type), '')) = '${RETURN_TYPE}'`;
}

function purchaseOnlyFilter(alias = 'p') {
  return `(COALESCE(TRIM(${alias}.transaction_type), '') = '' OR UPPER(TRIM(${alias}.transaction_type)) NOT IN ('RETURN', 'PURCHASE RETURN'))`;
}

export { RETURN_TYPE, returnTypeFilter, purchaseOnlyFilter };

export async function listReturnsByBranch(pool, companyId, branchId, limit = 50, offset = 0, options = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const params = [companyId, branchId];
  let where = `WHERE p.company_id = $1 AND p.branch_id = $2
       AND ${returnTypeFilter('p')}
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
            p.source_purchase_id, p.return_no,
            p.purchase_date, p.purchase_no, p.supplier_invoice_no,
            p.invoice_amount, p.outstanding_balance, p.payment_mode, p.post_status, p.remarks,
            p.subtotal_amount, p.input_tax_1_amount, p.record_status
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

export async function nextReturnId(client, companyId) {
  return purchaseEntryRepo.nextPurchaseId(client, companyId);
}

export async function nextReturnNo(client, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(
       MAX(
         CASE
           WHEN TRIM(return_no::text) ~ '^[0-9]+$' THEN TRIM(return_no::text)::bigint
           ELSE NULL
         END
       ),
       0
     ) + 1 AS n
     FROM ops.purchase_master
     WHERE company_id = $1 AND branch_id = $2
       AND UPPER(COALESCE(TRIM(transaction_type), '')) = 'RETURN'`,
    [companyId, branchId],
  );
  return String(Number(rows[0].n));
}

export async function getReturnMaster(pool, companyId, purchaseId) {
  const { rows } = await pool.query(
    `SELECT p.*, sm.supplier_name,
            src.purchase_no AS source_purchase_no,
            src.supplier_invoice_no AS source_supplier_invoice_no
     FROM ops.purchase_master p
     LEFT JOIN biz.supplier_master sm
       ON sm.company_id = p.company_id AND sm.supplier_id = p.supplier_id
     LEFT JOIN ops.purchase_master src
       ON src.company_id = p.company_id AND src.purchase_id = p.source_purchase_id
     WHERE p.company_id = $1 AND p.purchase_id = $2
       AND ${returnTypeFilter('p')}
       AND (p.record_status IS NULL OR p.record_status IN ('ACTIVE', 'CANCELLED'))
     LIMIT 1`,
    [companyId, purchaseId],
  );
  return rows[0] || null;
}

export async function findReturnByLookup(pool, companyId, branchId, { returnNo, supplierInvoiceNo } = {}) {
  const pno = returnNo != null ? String(returnNo).trim() : '';
  const sno = supplierInvoiceNo != null ? String(supplierInvoiceNo).trim() : '';
  if (!pno && !sno) return { kind: 'missing' };

  const params = [companyId, branchId];
  let where = `WHERE p.company_id = $1 AND p.branch_id = $2
       AND ${returnTypeFilter('p')}
       AND (p.record_status IS NULL OR p.record_status IN ('ACTIVE', 'CANCELLED'))`;

  if (pno) {
    params.push(pno);
    where += ` AND TRIM(p.return_no::text) = $${params.length}`;
  }
  if (sno) {
    params.push(sno);
    where += ` AND TRIM(UPPER(COALESCE(p.supplier_invoice_no, ''))) = TRIM(UPPER($${params.length}))`;
  }

  const { rows } = await pool.query(
    `SELECT p.purchase_id, p.return_no, p.purchase_no, p.supplier_invoice_no, p.post_status
     FROM ops.purchase_master p
     ${where}
     ORDER BY p.purchase_id DESC
     LIMIT 5`,
    params,
  );

  if (!rows.length) return { kind: 'not_found' };
  if (rows.length > 1 && !pno) return { kind: 'ambiguous', count: rows.length };
  const row = rows[0];
  return {
    kind: 'found',
    purchaseId: Number(row.purchase_id),
    returnNo: row.return_no != null ? String(row.return_no) : '',
    supplierInvoiceNo: row.supplier_invoice_no ?? null,
  };
}

export async function insertReturnMaster(client, row) {
  await client.query(
    `INSERT INTO ops.purchase_master (
       company_id, purchase_id, branch_id, supplier_id, grn_id, lpo_master_id,
       purchase_date, purchase_no, supplier_invoice_no,
       invoice_amount, outstanding_balance, payment_mode, post_status,
       discount_amount, round_off_adjustment, remarks,
       subtotal_amount, input_tax_1_amount, input_tax_2_amount, input_tax_3_amount,
       input_tax_1_rate, input_tax_2_rate, input_tax_3_rate,
       net_vat, items_total_bc, currency_rate,
       transaction_type, return_no, source_purchase_id,
       record_status, created_by, modified_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
       $27,$28,$29,$30,$31,$32
     )`,
    [
      row.companyId, row.purchaseId, row.branchId, row.supplierId,
      row.grnId ?? null, row.lpoMasterId ?? null,
      row.purchaseDate, row.purchaseNo, row.supplierInvoiceNo,
      row.invoiceAmount, row.outstandingBalance, row.paymentMode, row.postStatus,
      row.discountAmount ?? 0, row.roundOffAdjustment ?? 0, row.remarks ?? null,
      row.subtotalAmount, row.inputTax1Amount, row.inputTax2Amount ?? 0, row.inputTax3Amount ?? 0,
      row.inputTax1Rate, row.inputTax2Rate ?? 0, row.inputTax3Rate ?? 0,
      row.netVat, row.itemsTotalBc, row.currencyRate ?? 1,
      RETURN_TYPE, row.returnNo ?? null, row.sourcePurchaseId ?? null,
      row.recordStatus || 'ACTIVE', row.createdBy, row.modifiedBy,
    ],
  );
}

export async function updateReturnMaster(client, companyId, purchaseId, branchId, row) {
  await client.query(
    `UPDATE ops.purchase_master SET
       purchase_no = $4,
       supplier_id = $5,
       purchase_date = $6,
       supplier_invoice_no = $7,
       invoice_amount = $8,
       outstanding_balance = $9,
       payment_mode = $10,
       remarks = $11,
       discount_amount = $12,
       round_off_adjustment = $13,
       subtotal_amount = $14,
       input_tax_1_amount = $15,
       input_tax_1_rate = $16,
       net_vat = $17,
       items_total_bc = $18,
       return_no = $19,
       source_purchase_id = $20,
       modified_by = $21,
       modified_at = NOW()
     WHERE company_id = $1 AND purchase_id = $2 AND branch_id = $3
       AND UPPER(COALESCE(TRIM(transaction_type), '')) = 'RETURN'`,
    [
      companyId, purchaseId, branchId,
      row.purchaseNo ?? '0',
      row.supplierId, row.purchaseDate, row.supplierInvoiceNo,
      row.invoiceAmount, row.outstandingBalance, row.paymentMode, row.remarks,
      row.discountAmount ?? 0, row.roundOffAdjustment ?? 0,
      row.subtotalAmount, row.inputTax1Amount, row.inputTax1Rate,
      row.netVat, row.itemsTotalBc,
      row.returnNo ?? null, row.sourcePurchaseId ?? null,
      row.modifiedBy,
    ],
  );
}

export async function getSourcePurchaseForReturn(pool, companyId, branchId, purchaseNo) {
  const pno = String(purchaseNo || '').trim();
  if (!pno) return null;
  const { rows } = await pool.query(
    `SELECT p.*
     FROM ops.purchase_master p
     WHERE p.company_id = $1 AND p.branch_id = $2
       AND TRIM(p.purchase_no::text) = $3
       AND ${purchaseOnlyFilter('p')}
       AND (p.record_status IS NULL OR p.record_status IN ('ACTIVE', 'CANCELLED'))
     ORDER BY p.purchase_id DESC
     LIMIT 1`,
    [companyId, branchId, pno],
  );
  return rows[0] || null;
}

export const listPurchaseLines = purchaseEntryRepo.listPurchaseLines;
export const softDeletePurchaseChildren = purchaseEntryRepo.softDeletePurchaseChildren;
export const insertPurchaseChild = purchaseEntryRepo.insertPurchaseChild;
export const nextPurchaseChildId = purchaseEntryRepo.nextPurchaseChildId;
export const updatePurchasePostStatus = purchaseEntryRepo.updatePurchasePostStatus;
