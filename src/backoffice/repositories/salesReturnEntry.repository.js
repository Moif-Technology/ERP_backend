/**
 * Sales return — reuses ops.sales_master / ops.sales_child with transaction_type = 'RETURN'.
 */
import * as salesRepo from '../../pos/restaurant-pos/repositories/sales.repository.js';

const RETURN_TYPE = 'RETURN';

function returnTypeFilter(alias = 'sm') {
  return `UPPER(COALESCE(TRIM(${alias}.transaction_type), '')) = '${RETURN_TYPE}'`;
}

function saleOnlyFilter(alias = 'sm') {
  return `(COALESCE(TRIM(${alias}.transaction_type), '') = '' OR UPPER(TRIM(${alias}.transaction_type)) NOT IN ('RETURN', 'SALES RETURN'))`;
}

export { RETURN_TYPE, returnTypeFilter, saleOnlyFilter };

export async function listReturnsByBranch(pool, companyId, branchId, limit = 50, offset = 0, options = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const params = [companyId, branchId];
  let where = `WHERE sm.company_id = $1 AND sm.branch_id = $2
       AND ${returnTypeFilter('sm')}
       AND (sm.record_status IS NULL OR sm.record_status IN ('ACTIVE', 'CANCELLED'))`;
  if (options.dateFrom) {
    params.push(options.dateFrom);
    where += ` AND sm.bill_date >= $${params.length}::date`;
  }
  if (options.dateTo) {
    params.push(options.dateTo);
    where += ` AND sm.bill_date < ($${params.length}::date + interval '1 day')`;
  }
  params.push(lim, off);
  const { rows } = await pool.query(
    `SELECT sm.sales_id, sm.branch_id, sm.customer_id, cm.customer_name,
            sm.return_sales_id, sm.return_no,
            sm.bill_date, sm.bill_no, sm.invoice_no,
            sm.amount, sm.outstanding_balance, sm.payment_mode, sm.post_status, sm.remarks,
            sm.subtotal_amount,
            COALESCE(sm.tax_1_amount,0)+COALESCE(sm.tax_2_amount,0)+COALESCE(sm.tax_3_amount,0) AS tax_amount,
            sm.record_status
     FROM ops.sales_master sm
     LEFT JOIN biz.customer_master cm
       ON cm.company_id = sm.company_id AND cm.customer_id = sm.customer_id
     ${where}
     ORDER BY sm.bill_date DESC NULLS LAST, sm.sales_id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

export async function nextReturnId(client, companyId) {
  return salesRepo.nextSalesId(client, companyId);
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
     FROM ops.sales_master
     WHERE company_id = $1 AND branch_id = $2
       AND UPPER(COALESCE(TRIM(transaction_type), '')) = 'RETURN'`,
    [companyId, branchId],
  );
  return String(Number(rows[0].n));
}

export async function getReturnMaster(pool, companyId, salesId) {
  const { rows } = await pool.query(
    `SELECT sm.*, cm.customer_name, cm.customer_code,
            src.bill_no AS source_bill_no,
            src.invoice_no AS source_invoice_no
     FROM ops.sales_master sm
     LEFT JOIN biz.customer_master cm
       ON cm.company_id = sm.company_id AND cm.customer_id = sm.customer_id
     LEFT JOIN ops.sales_master src
       ON src.company_id = sm.company_id AND src.sales_id = sm.return_sales_id
     WHERE sm.company_id = $1 AND sm.sales_id = $2
       AND ${returnTypeFilter('sm')}
       AND (sm.record_status IS NULL OR sm.record_status IN ('ACTIVE', 'CANCELLED'))
     LIMIT 1`,
    [companyId, salesId],
  );
  return rows[0] || null;
}

export async function findReturnByLookup(pool, companyId, branchId, { returnNo, billNo, invoiceNo } = {}) {
  const rno = returnNo != null ? String(returnNo).trim() : '';
  const bno = billNo != null ? String(billNo).trim() : '';
  const ino = invoiceNo != null ? String(invoiceNo).trim() : '';
  if (!rno && !bno && !ino) return { kind: 'missing' };

  const params = [companyId, branchId];
  let where = `WHERE sm.company_id = $1 AND sm.branch_id = $2
       AND ${returnTypeFilter('sm')}
       AND (sm.record_status IS NULL OR sm.record_status IN ('ACTIVE', 'CANCELLED'))`;

  if (rno) {
    params.push(rno);
    where += ` AND TRIM(sm.return_no::text) = $${params.length}`;
  }
  if (bno) {
    params.push(bno);
    where += ` AND TRIM(sm.bill_no::text) = $${params.length}`;
  }
  if (ino) {
    params.push(ino);
    where += ` AND TRIM(COALESCE(sm.invoice_no, '')) = TRIM($${params.length})`;
  }

  const { rows } = await pool.query(
    `SELECT sm.sales_id, sm.return_no, sm.bill_no, sm.invoice_no, sm.post_status
     FROM ops.sales_master sm
     ${where}
     ORDER BY sm.sales_id DESC
     LIMIT 5`,
    params,
  );

  if (!rows.length) return { kind: 'not_found' };
  if (rows.length > 1 && !rno) return { kind: 'ambiguous', count: rows.length };
  const row = rows[0];
  return {
    kind: 'found',
    salesId: Number(row.sales_id),
    returnNo: row.return_no != null ? String(row.return_no) : '',
    billNo: row.bill_no != null ? String(row.bill_no) : '',
    invoiceNo: row.invoice_no ?? null,
  };
}

export async function insertReturnMaster(client, row) {
  await client.query(
    `INSERT INTO ops.sales_master (
       company_id, sales_id, branch_id, counter_no, bill_no, bill_date, bill_time,
       customer_id, payment_mode, credit_card_no,
       amount, cash_amount, credit_amount, credit_card_amount,
       paid_amount, balance_paid, outstanding_balance,
       discount_amount, subtotal_amount, taxable_amount,
       tax_1_amount, tax_2_amount, tax_3_amount,
       tax_1_rate, tax_2_rate, tax_3_rate,
       round_off_adjustment,
       post_status, transaction_type, return_no, return_sales_id,
       remarks, record_status, entry_source,
       created_by, modified_by
     ) VALUES (
       $1,$2,$3,$4,$5, COALESCE($6, NOW()), NOW(),
       $7,$8,$9,
       $10,$11,$12,$13,$14,$15,$16,
       $17,$18,$19,
       $20,$21,$22,
       $23,$24,$25,
       $26,
       $27,$28,$29,$30,
       $31,$32,'BACKOFFICE',
       $33,$34
     )`,
    [
      row.companyId, row.salesId, row.branchId, row.counterNo ?? 1, row.billNo,
      row.billDate ?? null,
      row.customerId, row.paymentMode, row.creditCardNo ?? null,
      row.amount, row.cashAmount ?? 0, row.creditAmount ?? 0, row.creditCardAmount ?? 0,
      row.paidAmount ?? 0, row.balancePaid ?? 0, row.outstandingBalance ?? 0,
      row.discountAmount ?? 0, row.subtotalAmount ?? 0, row.taxableAmount ?? 0,
      row.tax1Amount ?? 0, row.tax2Amount ?? 0, row.tax3Amount ?? 0,
      row.tax1Rate ?? 0, row.tax2Rate ?? 0, row.tax3Rate ?? 0,
      row.roundOffAdjustment ?? 0,
      row.postStatus ?? 'DRAFT', RETURN_TYPE, row.returnNo ?? null, row.returnSalesId ?? null,
      row.remarks ?? null, row.recordStatus || 'ACTIVE',
      row.createdBy, row.modifiedBy,
    ],
  );
}

export async function updateReturnMaster(client, companyId, salesId, branchId, row) {
  await client.query(
    `UPDATE ops.sales_master SET
       bill_no = $4,
       customer_id = $5,
       bill_date = COALESCE($6, bill_date),
       payment_mode = $7,
       remarks = $8,
       discount_amount = $9,
       round_off_adjustment = $10,
       subtotal_amount = $11,
       tax_1_amount = $12,
       tax_1_rate = $13,
       amount = $14,
       outstanding_balance = $15,
       return_no = $16,
       return_sales_id = $17,
       modified_by = $18,
       modified_at = NOW()
     WHERE company_id = $1 AND sales_id = $2 AND branch_id = $3
       AND UPPER(COALESCE(TRIM(transaction_type), '')) = 'RETURN'`,
    [
      companyId, salesId, branchId,
      row.billNo ?? 0,
      row.customerId, row.billDate ?? null, row.paymentMode, row.remarks,
      row.discountAmount ?? 0, row.roundOffAdjustment ?? 0,
      row.subtotalAmount ?? 0, row.tax1Amount ?? 0, row.tax1Rate ?? 0,
      row.amount ?? 0, row.outstandingBalance ?? 0,
      row.returnNo ?? null, row.returnSalesId ?? null,
      row.modifiedBy,
    ],
  );
}

export async function updateReturnPostStatus(client, companyId, salesId, branchId, postStatus) {
  await client.query(
    `UPDATE ops.sales_master
     SET post_status = $4, modified_at = NOW()
     WHERE company_id = $1 AND sales_id = $2 AND branch_id = $3
       AND UPPER(COALESCE(TRIM(transaction_type), '')) = 'RETURN'`,
    [companyId, salesId, branchId, postStatus],
  );
}

export async function getSourceSaleForReturn(pool, companyId, branchId, billNo) {
  const bno = String(billNo || '').trim();
  if (!bno) return null;
  const { rows } = await pool.query(
    `SELECT sm.*
     FROM ops.sales_master sm
     WHERE sm.company_id = $1 AND sm.branch_id = $2
       AND TRIM(sm.bill_no::text) = $3
       AND ${saleOnlyFilter('sm')}
       AND (sm.record_status IS NULL OR sm.record_status IN ('ACTIVE', 'CANCELLED'))
     ORDER BY sm.sales_id DESC
     LIMIT 1`,
    [companyId, branchId, bno],
  );
  return rows[0] || null;
}

export async function getSourceSaleByIdForReturn(pool, companyId, branchId, salesId) {
  const sid = Math.trunc(Number(salesId));
  if (!Number.isFinite(sid) || sid < 1) return null;
  const { rows } = await pool.query(
    `SELECT sm.*
     FROM ops.sales_master sm
     WHERE sm.company_id = $1 AND sm.branch_id = $2 AND sm.sales_id = $3
       AND ${saleOnlyFilter('sm')}
       AND (sm.record_status IS NULL OR sm.record_status IN ('ACTIVE', 'CANCELLED'))
     LIMIT 1`,
    [companyId, branchId, sid],
  );
  return rows[0] || null;
}

export async function listSaleLines(pool, companyId, salesId) {
  const { rows } = await pool.query(
    `SELECT sc.sales_child_id, sc.product_id, sc.short_description,
            sc.qty, sc.pack_qty, sc.unit_price, sc.unit_cost,
            sc.discount_amount, sc.subtotal_amount,
            sc.tax_1_amount, sc.tax_1_rate, sc.line_total,
            pm.product_code, pm.short_name, pm.product_name, pm.barcode, pm.own_ref_no
     FROM ops.sales_child sc
     LEFT JOIN core.product_master pm
       ON pm.company_id = sc.company_id AND pm.product_id = sc.product_id
     WHERE sc.company_id = $1 AND sc.sales_id = $2
     ORDER BY sc.sales_child_id`,
    [companyId, salesId],
  );
  return rows;
}

export async function softDeleteSaleChildren(client, companyId, salesId) {
  await client.query(
    `DELETE FROM ops.sales_child
     WHERE company_id = $1 AND sales_id = $2`,
    [companyId, salesId],
  );
}

export async function insertSaleChild(client, row) {
  return salesRepo.insertSalesChild(client, row);
}

export async function nextSalesChildId(client, companyId) {
  return salesRepo.nextSalesChildId(client, companyId);
}
