/**
 * Back-office sales: quotation / DO refs (029) + receipt ledger (031).
 */
import { saleOnlyFilter } from './salesReturnEntry.repository.js';

export async function getSaleMaster(pool, companyId, salesId) {
  const { rows } = await pool.query(
    `SELECT sm.*
     FROM ops.sales_master sm
     WHERE sm.company_id = $1 AND sm.sales_id = $2
       AND ${saleOnlyFilter('sm')}
     LIMIT 1`,
    [companyId, salesId],
  );
  return rows[0] || null;
}

export async function updateSalesMasterForEdit(client, companyId, salesId, row) {
  await client.query(
    `UPDATE ops.sales_master SET
       customer_id = $3,
       counter_no = $4,
       payment_mode = $5,
       credit_card_no = $6,
       amount = $7,
       cash_amount = $8,
       credit_amount = $9,
       credit_card_amount = $10,
       paid_amount = $11,
       balance_paid = $12,
       discount_amount = $13,
       subtotal_amount = $14,
       taxable_amount = $15,
       tax_1_amount = $16,
       tax_1_rate = $17,
       round_off_adjustment = $18,
       remarks = $19,
       modified_by = $20,
       modified_at = NOW()
     WHERE company_id = $1 AND sales_id = $2`,
    [
      companyId,
      salesId,
      row.customerId,
      row.counterNo,
      row.paymentMode,
      row.creditCardNo,
      row.amount,
      row.cashAmount,
      row.creditAmount,
      row.creditCardAmount,
      row.paidAmount,
      row.balancePaid,
      row.discountAmount,
      row.subtotalAmount,
      row.taxableAmount,
      row.tax1Amount,
      row.tax1Rate,
      row.roundOffAdj,
      row.remarks,
      row.modifiedBy,
    ],
  );
}

export async function deleteSalesPaymentSplits(client, companyId, salesId) {
  await client.query(
    `DELETE FROM ops.sales_payment_split
     WHERE company_id = $1 AND sales_id = $2`,
    [companyId, salesId],
  );
}

export async function insertSalesMaster(client, row) {
  const {
    companyId, salesId, branchId, kotMasterId, counterNo, billNo,
    customerId, paymentMode, creditCardNo,
    amount, cashAmount, creditAmount, creditCardAmount, paidAmount, balancePaid, discountAmount,
    subtotalAmount, taxableAmount,
    tax1Amount, tax2Amount, tax3Amount,
    tax1Rate, tax2Rate, tax3Rate,
    roundOffAdj,
    waiterId, tableId, areaId, noOfCustomers, staffId, remarks,
    createdBy, modifiedBy,
  } = row;
  await client.query(
    `INSERT INTO ops.sales_master (
        company_id, sales_id, branch_id, kot_master_id, counter_no, bill_no,
        bill_date, bill_time, customer_id, payment_mode, credit_card_no,
        amount, cash_amount, credit_amount, credit_card_amount, paid_amount, balance_paid, discount_amount,
        subtotal_amount, taxable_amount,
        tax_1_amount, tax_2_amount, tax_3_amount,
        tax_1_rate, tax_2_rate, tax_3_rate,
        round_off_adjustment,
        waiter_id, table_id, area_id, no_of_customers, staff_id, remarks,
        entry_source, created_by, modified_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6, NOW(), NOW(), $7,$8,$9,
        $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,
        'ERP',$32,$33
      )`,
    [
      companyId, salesId, branchId, kotMasterId, counterNo, billNo,
      customerId, paymentMode, creditCardNo,
      amount, cashAmount, creditAmount, creditCardAmount, paidAmount, balancePaid, discountAmount,
      subtotalAmount, taxableAmount,
      tax1Amount, tax2Amount, tax3Amount,
      tax1Rate, tax2Rate, tax3Rate,
      roundOffAdj,
      waiterId, tableId, areaId, noOfCustomers, staffId, remarks,
      createdBy, modifiedBy,
    ]
  );
}

export async function updateSalesMasterErpFields(client, companyId, salesId, fields) {
  const qid =
    fields.quotationId != null && Number.isFinite(Number(fields.quotationId)) && Number(fields.quotationId) >= 1
      ? Math.trunc(Number(fields.quotationId))
      : null;
  const did =
    fields.deliveryOrderId != null &&
    Number.isFinite(Number(fields.deliveryOrderId)) &&
    Number(fields.deliveryOrderId) >= 1
      ? Math.trunc(Number(fields.deliveryOrderId))
      : null;
  const lid =
    fields.receiptLedgerId != null &&
    Number.isFinite(Number(fields.receiptLedgerId)) &&
    Number(fields.receiptLedgerId) >= 1
      ? Math.trunc(Number(fields.receiptLedgerId))
      : null;
  await client.query(
    `UPDATE ops.sales_master
     SET quotation_id = $3,
         delivery_order_id = $4,
         receipt_ledger_id = $5
     WHERE company_id = $1 AND sales_id = $2`,
    [companyId, salesId, qid, did, lid]
  );
}

export async function getSaleById(pool, companyId, branchId, salesId) {
  const { rows } = await pool.query(
    `SELECT
       sm.sales_id, sm.branch_id, sm.bill_no, sm.invoice_no,
       sm.bill_date, sm.bill_time, sm.counter_no, sm.payment_mode,
       sm.customer_id, cm.customer_name, cm.customer_code,
       sm.subtotal_amount, sm.discount_amount,
       COALESCE(sm.tax_1_amount,0)+COALESCE(sm.tax_2_amount,0)+COALESCE(sm.tax_3_amount,0) AS tax_amount,
       sm.round_off_adjustment, sm.amount, sm.remarks,
       sm.quotation_id, sm.delivery_order_id,
       COALESCE(
         json_agg(
           json_build_object(
             'salesChildId', sc.sales_child_id,
             'productId',    sc.product_id,
             'shortDescription', sc.short_description,
             'qty',          sc.qty,
             'unitPrice',    sc.unit_price,
             'unitCost',     sc.unit_cost,
             'packQty',      sc.pack_qty,
             'discountAmount', sc.discount_amount,
             'subtotalAmount', sc.subtotal_amount,
             'tax1Rate',     sc.tax_1_rate,
             'tax1Amount',   sc.tax_1_amount,
             'lineTotal',    sc.line_total,
             'quotationId',  sc.quotation_id,
             'doId',         sc.do_id,
             'barcode',      pm.barcode,
             'ownRefNo',     pm.own_ref_no
           ) ORDER BY sc.sales_child_id
         ) FILTER (WHERE sc.sales_child_id IS NOT NULL),
         '[]'::json
       ) AS lines
     FROM ops.sales_master sm
     LEFT JOIN biz.customer_master cm
       ON cm.company_id = sm.company_id AND cm.customer_id = sm.customer_id
     LEFT JOIN ops.sales_child sc
       ON sc.company_id = sm.company_id AND sc.sales_id = sm.sales_id
     LEFT JOIN core.product_master pm
       ON pm.company_id = sm.company_id AND pm.product_id = sc.product_id
     WHERE sm.company_id = $1 AND sm.branch_id = $2 AND sm.sales_id = $3
     GROUP BY
       sm.sales_id, sm.branch_id, sm.bill_no, sm.invoice_no,
       sm.bill_date, sm.bill_time, sm.counter_no, sm.payment_mode,
       sm.customer_id, cm.customer_name, cm.customer_code,
       sm.subtotal_amount, sm.discount_amount,
       sm.tax_1_amount, sm.tax_2_amount, sm.tax_3_amount,
       sm.round_off_adjustment, sm.amount, sm.remarks,
       sm.quotation_id, sm.delivery_order_id`,
    [companyId, branchId, salesId],
  );
  return rows[0] || null;
}

export async function updateSalesPostStatus(client, companyId, salesId, branchId, postStatus) {
  await client.query(
    `UPDATE ops.sales_master
     SET post_status = $4, modified_at = NOW()
     WHERE company_id = $1 AND sales_id = $2 AND branch_id = $3`,
    [companyId, salesId, branchId, postStatus],
  );
}

export async function syncSalesPostStatusFromPostedVouchers(pool, companyId, branchId) {
  await pool.query(
    `UPDATE ops.sales_master sm
     SET post_status = 'POSTED', modified_at = NOW()
     FROM accounts.voucher_master vm
     WHERE sm.company_id = $1
       AND sm.branch_id = $2
       AND vm.company_id = sm.company_id
       AND vm.branch_id = sm.branch_id
       AND vm.voucher_posted_id = sm.sales_id
       AND vm.creation_mode = 'INVENTORYACCOUNTS'
       AND UPPER(COALESCE(vm.post_status, 'PENDING')) = 'POSTED'
       AND UPPER(COALESCE(sm.post_status, 'DRAFT')) <> 'POSTED'`,
    [companyId, branchId],
  );
}

export async function listSales(pool, companyId, branchId, limit, offset) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  await syncSalesPostStatusFromPostedVouchers(pool, companyId, branchId);
  const { rows } = await pool.query(
    `SELECT sm.sales_id,
            sm.branch_id,
            sm.counter_no,
            sm.bill_no,
            sm.bill_date,
            sm.bill_time,
            sm.payment_mode,
            sm.post_status AS sale_post_status,
            sm.transaction_type,
            sm.customer_id,
            cm.customer_code,
            cm.customer_name,
            cm.customer_tax_reg_no,
            st.staff_name,
            sm.subtotal_amount,
            sm.discount_amount,
            COALESCE(sm.tax_1_amount, 0) + COALESCE(sm.tax_2_amount, 0) + COALESCE(sm.tax_3_amount, 0) AS tax_amount,
            sm.round_off_adjustment,
            sm.amount,
            sm.remarks,
            sm.quotation_id,
            sm.delivery_order_id,
            sv.voucher_post_status,
            sv.voucher_master_id,
            COALESCE(osb.outstanding_balance, 0)::numeric AS outstanding_balance
     FROM ops.sales_master sm
     LEFT JOIN biz.customer_master cm
       ON cm.company_id = sm.company_id
      AND cm.customer_id = sm.customer_id
     LEFT JOIN core.staff_master st
       ON st.company_id = sm.company_id
      AND st.staff_id = sm.staff_id
     LEFT JOIN LATERAL (
       SELECT vm.voucher_master_id,
              UPPER(COALESCE(vm.post_status, 'PENDING')) AS voucher_post_status
       FROM accounts.voucher_master vm
       WHERE vm.company_id = sm.company_id
         AND vm.branch_id = sm.branch_id
         AND vm.voucher_posted_id = sm.sales_id
         AND vm.creation_mode = 'INVENTORYACCOUNTS'
         AND (vm.record_status IS NULL OR TRIM(UPPER(vm.record_status)) = 'ACTIVE')
       ORDER BY vm.voucher_master_id ASC
       LIMIT 1
     ) sv ON true
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(
         GREATEST(
           COALESCE(NULLIF(vd.outstanding_balance, 0), vd.debit_amount - vd.credit_amount, 0),
           0
         )
       ), 0)::numeric AS outstanding_balance
       FROM accounts.voucher_master vm
       INNER JOIN accounts.voucher_detail vd
         ON vd.company_id = vm.company_id
        AND vd.voucher_master_id = vm.voucher_master_id
       INNER JOIN accounts.account_head_master ah
         ON ah.company_id = vd.company_id
        AND ah.account_id = vd.account_id
        AND ah.account_no = cm.customer_code
        AND (ah.record_status IS NULL OR TRIM(UPPER(ah.record_status)) = 'ACTIVE')
       WHERE vm.company_id = sm.company_id
         AND vm.branch_id = sm.branch_id
         AND vm.voucher_posted_id = sm.sales_id
         AND vm.creation_mode = 'INVENTORYACCOUNTS'
         AND UPPER(COALESCE(vm.post_status, 'PENDING')) = 'POSTED'
         AND (vd.record_status IS NULL OR TRIM(UPPER(vd.record_status)) = 'ACTIVE')
         AND vd.debit_amount > 0
     ) osb ON true
     WHERE sm.company_id = $1
       AND sm.branch_id = $2
       AND ${saleOnlyFilter('sm')}
     ORDER BY sm.bill_date DESC, sm.sales_id DESC
     LIMIT $3 OFFSET $4`,
    [companyId, branchId, lim, off],
  );
  return rows;
}

/** Last unit price this product was sold to the customer (most recent sale line). */
export async function getLastCustomerSalePrice(
  pool,
  companyId,
  branchId,
  customerId,
  productId,
  excludeSalesId = null,
) {
  const params = [companyId, branchId, customerId, productId];
  let excludeClause = '';
  if (excludeSalesId != null && Number.isFinite(Number(excludeSalesId)) && Number(excludeSalesId) >= 1) {
    params.push(Math.trunc(Number(excludeSalesId)));
    excludeClause = ` AND sm.sales_id <> $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT sc.unit_price,
            sm.bill_date,
            sm.bill_no,
            sm.sales_id
     FROM ops.sales_child sc
     INNER JOIN ops.sales_master sm
       ON sm.company_id = sc.company_id AND sm.sales_id = sc.sales_id
     WHERE sm.company_id = $1
       AND sm.branch_id = $2
       AND sm.customer_id = $3
       AND sc.product_id = $4
       AND ${saleOnlyFilter('sm')}
       AND COALESCE(sm.record_status, 'ACTIVE') NOT IN ('CANCELLED', 'DELETED')
       ${excludeClause}
     ORDER BY sm.bill_date DESC NULLS LAST,
              sm.bill_time DESC NULLS LAST,
              sm.sales_id DESC,
              sc.sales_child_id DESC
     LIMIT 1`,
    params,
  );
  return rows[0] || null;
}
