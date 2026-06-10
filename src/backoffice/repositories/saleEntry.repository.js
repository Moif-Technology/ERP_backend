/**
 * Back-office sales: quotation / DO refs (029) + receipt ledger (031).
 */

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
