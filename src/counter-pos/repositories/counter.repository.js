/**
 * Counter close persistence: counter_close + cash_in_out + sales_master updates
 */

/**
 * Aggregate all PENDING sales totals for a cashier/counter session.
 * Returns one row with all payment mode totals.
 */
export async function getPendingSummary(pool, { companyId, branchId, counterNo, staffId }) {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN amount > 0 AND payment_mode = 'CASH'   THEN amount ELSE 0 END), 0) AS total_cash,
       COALESCE(SUM(CASE WHEN amount > 0 AND payment_mode = 'CREDIT' THEN amount ELSE 0 END), 0) AS total_credit,
       COALESCE(SUM(CASE WHEN amount > 0 AND payment_mode = 'CARD'   THEN amount ELSE 0 END), 0) AS total_card,
       COALESCE(SUM(CASE WHEN amount > 0 THEN discount_amount     ELSE 0 END), 0)  AS total_discount,
       COALESCE(SUM(CASE WHEN amount > 0 THEN round_off_adjustment ELSE 0 END), 0) AS total_round_off,
       COALESCE(SUM(CASE WHEN amount > 0 THEN tax_1_amount        ELSE 0 END), 0)  AS total_tax,
       COALESCE(SUM(CASE WHEN amount > 0 THEN amount              ELSE 0 END), 0)  AS gross_amount,
       COALESCE(ABS(SUM(CASE WHEN amount < 0 THEN amount          ELSE 0 END)), 0) AS total_refund,
       COUNT(CASE WHEN amount > 0 THEN 1 END)::INT                                          AS bill_count,
       COUNT(CASE WHEN amount > 0 AND payment_mode = 'CASH'   THEN 1 END)::INT              AS cash_bill_count,
       COUNT(CASE WHEN amount > 0 AND payment_mode = 'CREDIT' THEN 1 END)::INT              AS credit_bill_count,
       COUNT(CASE WHEN amount > 0 AND payment_mode = 'CARD'   THEN 1 END)::INT              AS card_bill_count,
       COUNT(CASE WHEN amount > 0 AND payment_mode = 'MULTI'  THEN 1 END)::INT              AS multi_bill_count,
       MIN(CASE WHEN amount > 0 THEN bill_no END)                                           AS start_bill_no,
       MAX(CASE WHEN amount > 0 THEN bill_no END)                                           AS end_bill_no
     FROM ops.sales_master
     WHERE company_id            = $1
       AND branch_id             = $2
       AND counter_no            = $3
       AND staff_id              = $4
       AND counter_close_status  = 'PENDING'
       AND post_status           = 'POSTED'
       AND COALESCE(hold_status, '') <> 'HOLD'`,
    [companyId, branchId, counterNo, staffId],
  );
  return rows[0];
}

/** SUM of cash in / cash out for this session (PENDING only) */
export async function getCashInOutTotals(pool, { companyId, branchId, counterNo, staffId }) {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN transaction_type = 'CASH_IN'  THEN amount ELSE 0 END), 0) AS cash_in,
       COALESCE(SUM(CASE WHEN transaction_type = 'CASH_OUT' THEN amount ELSE 0 END), 0) AS cash_out
     FROM ops.cash_in_out
     WHERE company_id  = $1
       AND branch_id   = $2
       AND counter_no  = $3
       AND staff_id    = $4
       AND close_status = 'PENDING'`,
    [companyId, branchId, counterNo, staffId],
  );
  return rows[0];
}

/**
 * Get next Z Report sequence number for this company.
 * Parses existing close_no values like "Z-C1-0003" to find max seq.
 */
export async function getNextCloseSeq(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(
       MAX(CAST(SPLIT_PART(close_no, '-', 3) AS INTEGER)),
       0
     ) + 1 AS next_seq
     FROM ops.counter_close
     WHERE company_id = $1 AND close_no IS NOT NULL
       AND close_no ~ '^Z-C[0-9]+-[0-9]+$'`,
    [companyId],
  );
  return Number(rows[0].next_seq);
}

/** Insert a counter close record. Returns the new row id and close_no. */
export async function insertCounterClose(client, data) {
  const { rows } = await client.query(
    `INSERT INTO ops.counter_close (
       company_id, branch_id, counter_no, staff_id, report_type, close_date,
       total_cash, total_credit, total_card, total_discount,
       total_refund, total_round_off, total_tax, gross_amount,
       cash_in, cash_out,
       cash_to_be_collected, collected_cash, cash_difference,
       bill_count, start_bill_no, end_bill_no, close_no
     ) VALUES (
       $1,$2,$3,$4,$5,NOW(),
       $6,$7,$8,$9,
       $10,$11,$12,$13,
       $14,$15,
       $16,$17,$18,
       $19,$20,$21,$22
     ) RETURNING id, close_no`,
    [
      data.companyId, data.branchId, data.counterNo, data.staffId, data.reportType,
      data.totalCash, data.totalCredit, data.totalCard, data.totalDiscount,
      data.totalRefund, data.totalRoundOff, data.totalTax, data.grossAmount,
      data.cashIn, data.cashOut,
      data.cashToBeCollected, data.collectedCash, data.cashDifference,
      data.billCount, data.startBillNo ?? null, data.endBillNo ?? null,
      data.closeNo ?? null,
    ],
  );
  return { id: rows[0].id, closeNo: rows[0].close_no };
}

/** Mark all PENDING sales for this session as closed with the close record id */
export async function markSalesAsClosed(client, { companyId, branchId, counterNo, staffId, closeId }) {
  const { rowCount } = await client.query(
    `UPDATE ops.sales_master
     SET counter_close_status = $1, modified_at = NOW()
     WHERE company_id           = $2
       AND branch_id            = $3
       AND counter_no           = $4
       AND staff_id             = $5
       AND counter_close_status = 'PENDING'
       AND post_status          = 'POSTED'
       AND COALESCE(hold_status, '') <> 'HOLD'`,
    [String(closeId), companyId, branchId, counterNo, staffId],
  );
  return rowCount;
}

/** Mark all PENDING cash in/out entries as closed */
export async function markCashInOutAsClosed(client, { companyId, branchId, counterNo, staffId, closeId }) {
  await client.query(
    `UPDATE ops.cash_in_out
     SET close_status = 'CLOSED', counter_close_id = $1
     WHERE company_id  = $2
       AND branch_id   = $3
       AND counter_no  = $4
       AND staff_id    = $5
       AND close_status = 'PENDING'`,
    [closeId, companyId, branchId, counterNo, staffId],
  );
}

/** Insert a cash in or cash out entry */
export async function insertCashInOut(pool, { companyId, branchId, counterNo, staffId, transactionType, amount, remarks }) {
  const { rows } = await pool.query(
    `INSERT INTO ops.cash_in_out (
       company_id, branch_id, counter_no, staff_id,
       transaction_type, amount, remarks
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, transaction_type, amount, remarks, created_at`,
    [companyId, branchId, counterNo, staffId, transactionType, amount, remarks ?? null],
  );
  return rows[0];
}

/** List cash in/out for current session */
export async function getCashInOutList(pool, { companyId, branchId, counterNo, staffId }) {
  const { rows } = await pool.query(
    `SELECT id, transaction_type, amount, remarks, created_at
     FROM ops.cash_in_out
     WHERE company_id  = $1
       AND branch_id   = $2
       AND counter_no  = $3
       AND staff_id    = $4
       AND close_status = 'PENDING'
     ORDER BY created_at`,
    [companyId, branchId, counterNo, staffId],
  );
  return rows;
}

/** List past counter closes (history) */
export async function getCloseHistory(pool, { companyId, branchId, counterNo, staffId, limit }) {
  const { rows } = await pool.query(
    `SELECT id, close_no, report_type, close_date,
            total_cash, total_credit, total_card, gross_amount,
            cash_to_be_collected, collected_cash, cash_difference,
            bill_count
     FROM ops.counter_close
     WHERE company_id = $1
       AND branch_id  = $2
       AND counter_no = $3
       AND staff_id   = $4
     ORDER BY close_date DESC
     LIMIT $5`,
    [companyId, branchId, counterNo, staffId, limit ?? 30],
  );
  return rows;
}

/** Single close record detail */
export async function getCloseById(pool, { companyId, closeId }) {
  const { rows } = await pool.query(
    `SELECT * FROM ops.counter_close
     WHERE company_id = $1 AND id = $2`,
    [companyId, closeId],
  );
  return rows[0] ?? null;
}
