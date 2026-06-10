/**
 * POS sales persistence: sales_master + sales_child + sales_payment_split
 * All mutations use a passed-in client so they run inside one transaction.
 */

/** Next hold_no per company */
export async function getNextHoldNo(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(CASE WHEN hold_no ~ '^[0-9]+$' THEN hold_no::bigint ELSE 0 END), 0) + 1 AS next_hold
     FROM ops.sales_master
     WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].next_hold);
}

/** Next sequential sales_id (= bill_no) per company — call inside a transaction with FOR UPDATE */
export async function getNextSalesId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(sales_id), 0) + 1 AS next_id
     FROM ops.sales_master
     WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].next_id);
}

/** Next N sequential sales_child_ids per company */
export async function getNextSalesChildIdBase(client, companyId, count) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(sales_child_id), 0) + 1 AS base
     FROM ops.sales_child
     WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].base);
}

export async function insertSalesMaster(client, m) {
  await client.query(
    `INSERT INTO ops.sales_master (
       company_id, sales_id, branch_id, counter_no, bill_no, bill_date, bill_time,
       customer_id, payment_mode,
       subtotal_amount, discount_amount, taxable_amount,
       tax_1_amount, tax_1_rate,
       round_off_adjustment, amount,
       paid_amount, balance_paid,
       cash_amount, credit_amount, credit_card_amount,
       staff_id, post_status, transaction_type, entry_source,
       prefix, created_by, counter_close_status
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,
       $8,$9,
       $10,$11,$12,
       $13,$14,
       $15,$16,
       $17,$18,
       $19,$20,$21,
       $22,'POSTED','SALE','COUNTER-POS',
       $23,$24,'PENDING'
     )`,
    [
      m.companyId, m.salesId, m.branchId, m.counterNo, m.salesId, m.billDate, m.billDate,
      m.customerId ?? null, m.paymentMode,
      m.subTotal, m.discountAmt, m.taxableAmt,
      m.taxAmt, m.taxRate,
      m.roundOff, m.netAmount,
      m.paidAmount, m.balanceAmount,
      m.paymentMode === 'CASH'   ? m.paidAmount : 0,
      m.paymentMode === 'CREDIT' ? m.paidAmount : 0,
      m.paymentMode === 'CARD'   ? m.paidAmount : 0,
      m.staffId, m.prefix ?? 'B-', String(m.staffId),
    ],
  );
}

export async function insertSalesChildren(client, companyId, salesId, branchId, items, childIdBase, staffId) {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const childId = childIdBase + i;
    await client.query(
      `INSERT INTO ops.sales_child (
         company_id, sales_child_id, sales_id, branch_id,
         product_id, product_code, short_description,
         qty, unit_price, unit_cost, discount_amount,
         subtotal_amount, tax_1_amount, tax_1_rate, line_total,
         post_status, created_by
       ) VALUES (
         $1,$2,$3,$4,
         $5,$6,$7,
         $8,$9,$10,$11,
         $12,$13,$14,$15,
         'POSTED',$16
       )`,
      [
        companyId, childId, salesId, branchId,
        it.productId, it.productCode ?? null, it.description,
        it.qty, it.unitPrice, it.unitPrice, it.discount ?? 0,
        it.qty * it.unitPrice,
        it.vatAmt ?? 0, it.vatPer ?? 0,
        it.lineTotal,
        String(staffId),
      ],
    );
  }
}

export async function insertHoldMaster(client, m) {
  await client.query(
    `INSERT INTO ops.sales_master (
       company_id, sales_id, branch_id, counter_no, bill_no, bill_date, bill_time,
       customer_id, payment_mode,
       subtotal_amount, discount_amount, taxable_amount,
       tax_1_amount, tax_1_rate,
       round_off_adjustment, amount,
       paid_amount, balance_paid,
       cash_amount, credit_amount, credit_card_amount,
       staff_id, post_status, hold_status, hold_no,
       transaction_type, entry_source, prefix, created_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,
       $8,$9,
       $10,$11,$12,
       $13,$14,
       $15,$16,
       $17,$18,
       $19,$20,$21,
       $22,'HOLD','HOLD',$23,
       'SALE','COUNTER-POS',$24,$25
     )`,
    [
      m.companyId, m.salesId, m.branchId, m.counterNo, m.salesId, m.billDate, m.billDate,
      m.customerId ?? null, m.paymentMode ?? 'CASH',
      m.subTotal ?? 0, m.discountAmt ?? 0, m.taxableAmt ?? 0,
      m.taxAmt ?? 0, m.taxRate ?? 0,
      m.roundOff ?? 0, m.netAmount ?? 0,
      0, 0,
      0, 0, 0,
      m.staffId, String(m.holdNo), m.prefix ?? 'B-', String(m.staffId),
    ],
  );
}

/** List all active held bills for company */
export async function getHeldBills(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT sm.sales_id, sm.hold_no, sm.bill_date, sm.customer_id,
            sm.amount, sm.payment_mode, sm.staff_id, sm.remarks,
            COUNT(sc.id) AS item_count
     FROM ops.sales_master sm
     LEFT JOIN ops.sales_child sc ON sc.sales_id = sm.sales_id AND sc.company_id = sm.company_id
     WHERE sm.company_id = $1 AND sm.branch_id = $2
       AND sm.hold_status = 'HOLD' AND COALESCE(sm.record_status,'') <> 'CANCELLED'
     GROUP BY sm.sales_id, sm.hold_no, sm.bill_date, sm.customer_id,
              sm.amount, sm.payment_mode, sm.staff_id, sm.remarks
     ORDER BY sm.hold_no::bigint`,
    [companyId, branchId],
  );
  return rows;
}

/** Get line items for a single held bill */
export async function getHeldBillItems(pool, companyId, salesId) {
  const { rows } = await pool.query(
    `SELECT sc.sales_child_id, sc.product_id, sc.product_code,
            sc.short_description, sc.qty, sc.unit_price, sc.discount_amount,
            sc.subtotal_amount, sc.tax_1_amount, sc.tax_1_rate, sc.line_total,
            sc.modifier
     FROM ops.sales_child sc
     JOIN ops.sales_master sm ON sm.sales_id = sc.sales_id AND sm.company_id = sc.company_id
     WHERE sc.company_id = $1 AND sc.sales_id = $2
       AND sm.hold_status = 'HOLD'`,
    [companyId, salesId],
  );
  return rows;
}

/** Cancel a held bill (soft delete) */
export async function cancelHoldBill(pool, companyId, salesId) {
  const { rowCount } = await pool.query(
    `UPDATE ops.sales_master
     SET hold_status = 'CANCELLED', record_status = 'CANCELLED', modified_at = NOW()
     WHERE company_id = $1 AND sales_id = $2 AND hold_status = 'HOLD'`,
    [companyId, salesId],
  );
  return rowCount;
}

/** Hard-delete held master + children when bill is finalized */
export async function deleteHoldBill(client, companyId, salesId) {
  await client.query(
    `DELETE FROM ops.sales_child WHERE company_id = $1 AND sales_id = $2`,
    [companyId, salesId],
  );
  await client.query(
    `DELETE FROM ops.sales_master WHERE company_id = $1 AND sales_id = $2 AND hold_status = 'HOLD'`,
    [companyId, salesId],
  );
}

/** Staff-wise sales totals for a pending counter session */
export async function getStaffWiseSales(pool, { companyId, branchId, counterNo }) {
  const { rows } = await pool.query(
    `SELECT
       sm.staff_id,
       s.staff_name,
       COUNT(*)  FILTER (WHERE sm.amount > 0)::INT                                       AS bill_count,
       COALESCE(SUM(CASE WHEN sm.amount > 0 THEN sm.amount              ELSE 0 END), 0)  AS gross_amount,
       COALESCE(SUM(CASE WHEN sm.amount > 0 THEN sm.discount_amount     ELSE 0 END), 0)  AS total_discount,
       COALESCE(SUM(CASE WHEN sm.amount > 0 THEN sm.round_off_adjustment ELSE 0 END), 0) AS total_round_off,
       COALESCE(SUM(CASE WHEN sm.amount > 0 THEN sm.amount - sm.discount_amount + sm.round_off_adjustment ELSE 0 END), 0) AS net_amount,
       COALESCE(SUM(CASE WHEN sm.amount > 0 AND sm.payment_mode = 'CASH'   THEN sm.amount ELSE 0 END), 0) AS total_cash,
       COALESCE(SUM(CASE WHEN sm.amount > 0 AND sm.payment_mode = 'CARD'   THEN sm.amount ELSE 0 END), 0) AS total_card,
       COALESCE(SUM(CASE WHEN sm.amount > 0 AND sm.payment_mode = 'CREDIT' THEN sm.amount ELSE 0 END), 0) AS total_credit
     FROM ops.sales_master sm
     LEFT JOIN core.staff_master s ON s.staff_id = sm.staff_id AND s.company_id = sm.company_id
     WHERE sm.company_id  = $1
       AND sm.branch_id  = $2
       AND sm.counter_no = $3
       AND sm.post_status = 'POSTED'
       AND COALESCE(sm.hold_status, '') NOT IN ('HOLD', 'CANCELLED')
     GROUP BY sm.staff_id, s.staff_name
     ORDER BY net_amount DESC`,
    [companyId, branchId, counterNo],
  );
  return rows;
}

export async function insertPaymentSplit(client, m) {
  await client.query(
    `INSERT INTO ops.sales_payment_split (
       company_id, sales_id, branch_id, counter_id,
       payer_no, pay_mode, bill_amount, staff_id, pay_date
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      m.companyId, m.salesId, m.branchId, m.counterNo,
      1, m.paymentMode, m.netAmount, m.staffId, m.billDate,
    ],
  );
}
