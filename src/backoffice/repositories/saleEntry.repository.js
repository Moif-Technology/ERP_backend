/**
 * Back-office sales: quotation / DO refs (029) + receipt ledger (031).
 */

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

export async function listSales(pool, companyId, branchId, limit, offset) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const { rows } = await pool.query(
    `SELECT sm.sales_id,
            sm.branch_id,
            sm.counter_no,
            sm.bill_no,
            sm.bill_date,
            sm.bill_time,
            sm.payment_mode,
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
            sm.delivery_order_id
     FROM ops.sales_master sm
     LEFT JOIN biz.customer_master cm
       ON cm.company_id = sm.company_id
      AND cm.customer_id = sm.customer_id
     LEFT JOIN core.staff_master st
       ON st.company_id = sm.company_id
      AND st.staff_id = sm.staff_id
     WHERE sm.company_id = $1
       AND sm.branch_id = $2
     ORDER BY sm.bill_date DESC, sm.sales_id DESC
     LIMIT $3 OFFSET $4`,
    [companyId, branchId, lim, off],
  );
  return rows;
}
