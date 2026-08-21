/**
 * Counter close persistence: counter_close + cash_in_out + sales_master updates
 */

/**
 * Aggregate PENDING sales totals for a counter session.
 * allStaff=true (admin close): every cashier on this counter — no staff_id filter.
 */
export async function getPendingSummary(pool, { companyId, stationId, counterNo, staffId, allStaff = false }) {
  const params = [companyId, stationId, counterNo];
  let staffClause = '';
  if (!allStaff) {
    params.push(staffId);
    staffClause = `AND staff_id = $${params.length}`;
  }
  const { rows } = await pool.query(
    `WITH sm AS (
       SELECT
         company_id, sales_id, branch_id, station_id, counter_no, staff_id,
         bill_no, amount, payment_mode,
         discount_amount, round_off_adjustment, tax_1_amount,
         transaction_type, cash_amount, credit_card_amount, credit_amount
       FROM ops.sales_master
       WHERE company_id            = $1
         AND station_id            = $2
         AND counter_no            = $3
         ${staffClause}
         AND COALESCE(NULLIF(TRIM(counter_close_status), ''), 'PENDING') = 'PENDING'
         AND post_status           = 'POSTED'
         AND UPPER(COALESCE(hold_status, '')) NOT IN ('HOLD', 'DELIVERY')
     ),
     bill_pay AS (
       SELECT
         sm.sales_id,
         sm.transaction_type,
         CASE
           WHEN COALESCE(split.split_rows, 0) > 0 THEN COALESCE(split.cash_amt, 0)
           WHEN UPPER(COALESCE(sm.payment_mode, '')) = 'CASH' THEN sm.amount
           ELSE COALESCE(sm.cash_amount, 0)
         END AS cash_amt,
         CASE
           WHEN COALESCE(split.split_rows, 0) > 0
             THEN COALESCE(split.card_amt, 0) + COALESCE(split.online_amt, 0)
           WHEN UPPER(COALESCE(sm.payment_mode, '')) IN ('CARD', 'CREDITCARD', 'CREDIT CARD')
             THEN sm.amount
           ELSE COALESCE(sm.credit_card_amount, 0)
         END AS card_amt,
         CASE
           WHEN COALESCE(split.split_rows, 0) > 0 THEN COALESCE(split.credit_amt, 0)
           WHEN UPPER(COALESCE(sm.payment_mode, '')) = 'CREDIT' THEN sm.amount
           ELSE COALESCE(sm.credit_amount, 0)
         END AS credit_amt,
         CASE
           WHEN COALESCE(split.split_rows, 0) > 0 THEN COALESCE(split.online_amt, 0)
           ELSE 0
         END AS online_amt,
         CASE
           WHEN COALESCE(split.split_rows, 0) > 0 THEN COALESCE(split.voucher_amt, 0)
           WHEN UPPER(COALESCE(sm.payment_mode, '')) = 'VOUCHER' THEN sm.amount
           ELSE 0
         END AS voucher_amt,
         COALESCE(split.tip_amt, 0) AS tip_amt,
         COALESCE(split.cash_tip_amt, 0) AS cash_tip_amt,
         COALESCE(split.card_tip_amt, 0) AS card_tip_amt
       FROM sm
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::INT AS split_rows,
           COALESCE(SUM(sps.bill_amount) FILTER (
             WHERE UPPER(TRIM(COALESCE(sps.pay_mode, ''))) = 'CASH'
           ), 0) AS cash_amt,
           COALESCE(SUM(sps.bill_amount) FILTER (
             WHERE UPPER(TRIM(COALESCE(sps.pay_mode, ''))) IN ('CARD', 'CREDITCARD', 'CREDIT CARD')
           ), 0) AS card_amt,
           COALESCE(SUM(sps.bill_amount) FILTER (
             WHERE UPPER(TRIM(COALESCE(sps.pay_mode, ''))) = 'ONLINE'
           ), 0) AS online_amt,
           COALESCE(SUM(sps.bill_amount) FILTER (
             WHERE UPPER(TRIM(COALESCE(sps.pay_mode, ''))) = 'VOUCHER'
           ), 0) AS voucher_amt,
           COALESCE(SUM(sps.bill_amount) FILTER (
             WHERE UPPER(TRIM(COALESCE(sps.pay_mode, ''))) = 'CREDIT'
           ), 0) AS credit_amt,
           COALESCE(SUM(COALESCE(sps.tip_amount, 0)), 0) AS tip_amt,
           COALESCE(SUM(COALESCE(sps.tip_amount, 0)) FILTER (
             WHERE UPPER(TRIM(COALESCE(sps.pay_mode, ''))) = 'CASH'
           ), 0) AS cash_tip_amt,
           COALESCE(SUM(COALESCE(sps.tip_amount, 0)) FILTER (
             WHERE UPPER(TRIM(COALESCE(sps.pay_mode, ''))) IN ('CARD', 'CREDITCARD', 'CREDIT CARD')
           ), 0) AS card_tip_amt
         FROM ops.sales_payment_split sps
         WHERE sps.company_id = sm.company_id
           AND sps.sales_id = sm.sales_id
       ) split ON true
     )
     SELECT
       COALESCE((
         SELECT SUM(CASE WHEN transaction_type = 'RETURN' THEN -cash_amt ELSE cash_amt END)
         FROM bill_pay
       ), 0) AS total_cash,
       COALESCE((
         SELECT SUM(CASE WHEN transaction_type = 'RETURN' THEN -credit_amt ELSE credit_amt END)
         FROM bill_pay
       ), 0) AS total_credit,
       COALESCE((
         SELECT SUM(CASE WHEN transaction_type = 'RETURN' THEN -card_amt ELSE card_amt END)
         FROM bill_pay
       ), 0) AS total_card,
       COALESCE((
         SELECT SUM(CASE WHEN transaction_type = 'RETURN' THEN -online_amt ELSE online_amt END)
         FROM bill_pay
       ), 0) AS total_online,
       COALESCE((
         SELECT SUM(CASE WHEN transaction_type = 'RETURN' THEN -voucher_amt ELSE voucher_amt END)
         FROM bill_pay
       ), 0) AS total_voucher,
       COALESCE((
         SELECT SUM(sc.discount_amount)
         FROM ops.sales_child sc
         INNER JOIN sm ON sm.sales_id = sc.sales_id AND sm.company_id = sc.company_id
         WHERE sm.amount > 0
       ), 0) AS item_discount_total,
       COALESCE(SUM(CASE WHEN amount > 0 THEN discount_amount     ELSE 0 END), 0)  AS total_discount,
       COALESCE(SUM(CASE WHEN amount > 0 THEN round_off_adjustment ELSE 0 END), 0) AS total_round_off,
       COALESCE(SUM(CASE WHEN amount > 0 THEN tax_1_amount        ELSE 0 END), 0)  AS total_tax,
       COALESCE(SUM(CASE WHEN amount > 0 THEN amount              ELSE 0 END), 0)  AS gross_amount,
       COALESCE((
         SELECT SUM(CASE WHEN transaction_type = 'RETURN' THEN 0 ELSE tip_amt END)
         FROM bill_pay
       ), 0) AS total_tip,
       COALESCE((
         SELECT SUM(CASE WHEN transaction_type = 'RETURN' THEN 0 ELSE cash_tip_amt END)
         FROM bill_pay
       ), 0) AS total_cash_tip,
       COALESCE((
         SELECT SUM(CASE WHEN transaction_type = 'RETURN' THEN 0 ELSE card_tip_amt END)
         FROM bill_pay
       ), 0) AS total_card_tip,
       COALESCE(SUM(CASE
         WHEN transaction_type = 'RETURN' AND amount > 0 THEN amount
         WHEN amount < 0 THEN ABS(amount)
         ELSE 0
       END), 0) AS total_refund,
       COUNT(CASE WHEN amount > 0 THEN 1 END)::INT                                          AS bill_count,
       COUNT(CASE WHEN amount > 0 AND payment_mode = 'CASH'   THEN 1 END)::INT              AS cash_bill_count,
       COUNT(CASE WHEN amount > 0 AND payment_mode = 'CREDIT' THEN 1 END)::INT              AS credit_bill_count,
       COUNT(CASE WHEN amount > 0 AND UPPER(COALESCE(payment_mode, '')) IN ('CARD', 'CREDITCARD', 'CREDIT CARD') THEN 1 END)::INT              AS card_bill_count,
       COUNT(CASE WHEN amount > 0 AND UPPER(COALESCE(payment_mode, '')) IN ('MULTI', 'MULTIPAYMENT') THEN 1 END)::INT              AS multi_bill_count,
       COUNT(CASE WHEN amount > 0 AND UPPER(COALESCE(payment_mode, '')) IN ('COMPLIMENT', 'COMPLIMENTARY') THEN 1 END)::INT     AS compliment_bill_count,
       MIN(CASE WHEN amount > 0 THEN bill_no END)                                           AS start_bill_no,
       MAX(CASE WHEN amount > 0 THEN bill_no END)                                           AS end_bill_no
     FROM sm`,
    params,
  );
  return rows[0] ?? {
    total_cash: 0, total_credit: 0, total_card: 0, total_online: 0, total_voucher: 0,
    total_discount: 0, item_discount_total: 0, total_round_off: 0, total_tax: 0, gross_amount: 0,
    total_tip: 0, total_cash_tip: 0, total_card_tip: 0,
    total_refund: 0, bill_count: 0, cash_bill_count: 0, credit_bill_count: 0,
    card_bill_count: 0, multi_bill_count: 0, compliment_bill_count: 0,
    start_bill_no: null, end_bill_no: null,
  };
}

/**
 * Pending sales broken down by cashier/staff for counter close UI + X/Z print.
 * Returns: staff_id, staff_name, bill_count, sale_amount, tip_amount.
 */
export async function getPendingStaffBreakdown(pool, {
  companyId, stationId, counterNo, staffId, allStaff = false,
}) {
  const params = [companyId, stationId, counterNo];
  let staffClause = '';
  if (!allStaff) {
    params.push(staffId);
    staffClause = `AND sm.staff_id = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT
       sm.staff_id,
       COALESCE(NULLIF(TRIM(st.staff_name), ''), 'Staff #' || sm.staff_id::text) AS staff_name,
       COUNT(*) FILTER (WHERE sm.amount > 0)::INT AS bill_count,
       COALESCE(SUM(CASE WHEN sm.amount > 0 THEN sm.amount ELSE 0 END), 0) AS sale_amount,
       COALESCE(SUM(CASE WHEN sm.amount > 0 THEN COALESCE(tip.tip_amt, 0) ELSE 0 END), 0) AS tip_amount,
       COALESCE(SUM(CASE
         WHEN sm.transaction_type = 'RETURN' AND sm.amount > 0 THEN sm.amount
         WHEN sm.amount < 0 THEN ABS(sm.amount)
         ELSE 0
       END), 0) AS refund_amount,
       COALESCE(SUM(CASE WHEN sm.amount > 0 THEN COALESCE(sm.cash_amount, 0) ELSE 0 END), 0) AS cash_amount,
       COALESCE(SUM(CASE WHEN sm.amount > 0 THEN COALESCE(sm.credit_card_amount, 0) ELSE 0 END), 0) AS card_amount,
       COALESCE(SUM(CASE WHEN sm.amount > 0 THEN COALESCE(sm.credit_amount, 0) ELSE 0 END), 0) AS credit_amount
     FROM ops.sales_master sm
     LEFT JOIN LATERAL (
       SELECT s.staff_name
         FROM core.staff_master s
        WHERE s.company_id = sm.company_id
          AND (s.id = sm.staff_id OR s.staff_id = sm.staff_id)
        ORDER BY CASE WHEN s.id = sm.staff_id THEN 0 ELSE 1 END
        LIMIT 1
     ) st ON TRUE
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(COALESCE(sps.tip_amount, 0)), 0) AS tip_amt
         FROM ops.sales_payment_split sps
        WHERE sps.company_id = sm.company_id
          AND sps.sales_id = sm.sales_id
     ) tip ON TRUE
     WHERE sm.company_id = $1
       AND sm.station_id = $2
       AND sm.counter_no = $3
       ${staffClause}
       AND COALESCE(NULLIF(TRIM(sm.counter_close_status), ''), 'PENDING') = 'PENDING'
       AND sm.post_status = 'POSTED'
       AND UPPER(COALESCE(sm.hold_status, '')) NOT IN ('HOLD', 'DELIVERY')
     GROUP BY sm.staff_id, st.staff_name
     HAVING COUNT(*) FILTER (WHERE sm.amount > 0) > 0
         OR COALESCE(SUM(CASE WHEN sm.amount > 0 THEN sm.amount ELSE 0 END), 0) <> 0
     ORDER BY staff_name ASC NULLS LAST, sm.staff_id ASC`,
    params,
  );
  return rows;
}

/**
 * Staff breakdown for a completed Z-close (sales linked via counter_close_status = closeId).
 */
export async function getStaffBreakdownForClose(pool, { companyId, closeId }) {
  const { rows } = await pool.query(
    `SELECT
       sm.staff_id,
       COALESCE(NULLIF(TRIM(st.staff_name), ''), 'Staff #' || sm.staff_id::text) AS staff_name,
       COUNT(*) FILTER (WHERE sm.amount > 0)::INT AS bill_count,
       COALESCE(SUM(CASE WHEN sm.amount > 0 THEN sm.amount ELSE 0 END), 0) AS sale_amount,
       COALESCE(SUM(CASE WHEN sm.amount > 0 THEN COALESCE(tip.tip_amt, 0) ELSE 0 END), 0) AS tip_amount,
       COALESCE(SUM(CASE
         WHEN sm.transaction_type = 'RETURN' AND sm.amount > 0 THEN sm.amount
         WHEN sm.amount < 0 THEN ABS(sm.amount)
         ELSE 0
       END), 0) AS refund_amount,
       COALESCE(SUM(CASE WHEN sm.amount > 0 THEN COALESCE(sm.cash_amount, 0) ELSE 0 END), 0) AS cash_amount,
       COALESCE(SUM(CASE WHEN sm.amount > 0 THEN COALESCE(sm.credit_card_amount, 0) ELSE 0 END), 0) AS card_amount,
       COALESCE(SUM(CASE WHEN sm.amount > 0 THEN COALESCE(sm.credit_amount, 0) ELSE 0 END), 0) AS credit_amount
     FROM ops.sales_master sm
     LEFT JOIN LATERAL (
       SELECT s.staff_name
         FROM core.staff_master s
        WHERE s.company_id = sm.company_id
          AND (s.id = sm.staff_id OR s.staff_id = sm.staff_id)
        ORDER BY CASE WHEN s.id = sm.staff_id THEN 0 ELSE 1 END
        LIMIT 1
     ) st ON TRUE
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(COALESCE(sps.tip_amount, 0)), 0) AS tip_amt
         FROM ops.sales_payment_split sps
        WHERE sps.company_id = sm.company_id
          AND sps.sales_id = sm.sales_id
     ) tip ON TRUE
     WHERE sm.company_id = $1
       AND TRIM(COALESCE(sm.counter_close_status, '')) = TRIM($2::text)
       AND sm.post_status = 'POSTED'
     GROUP BY sm.staff_id, st.staff_name
     HAVING COUNT(*) FILTER (WHERE sm.amount > 0) > 0
         OR COALESCE(SUM(CASE WHEN sm.amount > 0 THEN sm.amount ELSE 0 END), 0) <> 0
     ORDER BY staff_name ASC NULLS LAST, sm.staff_id ASC`,
    [companyId, String(closeId)],
  );
  return rows;
}

/** Credit settlement receipts (customer receipt) still pending counter close. */
export async function getCreditReceiptTotals(pool, { companyId, stationId, counterNo, staffId, allStaff = false }) {
  try {
    const params = [companyId, stationId, counterNo];
    let staffClause = '';
    if (!allStaff) {
      params.push(String(staffId));
      staffClause = 'AND created_by::text = TRIM($4::text)';
    }
    const { rows } = await pool.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (
           WHERE UPPER(TRIM(COALESCE(payment_mode, ''))) = 'CASH'
         ), 0) AS receipt_cash,
         COALESCE(SUM(amount) FILTER (
           WHERE UPPER(TRIM(COALESCE(payment_mode, ''))) IN ('CARD', 'CREDITCARD')
         ), 0) AS receipt_card,
         COUNT(*)::INT AS receipt_count
       FROM accounts.cash_transaction_master
       WHERE company_id = $1
         AND branch_id  = $2
         AND counter_no = $3
         ${staffClause}
         AND UPPER(COALESCE(status, 'ACTIVE')) = 'ACTIVE'
         AND UPPER(COALESCE(transaction_type, '')) IN (
           'CUSTOMER RECEIPT', 'CUSTOMER_RECEIPT', 'RECEIPT'
         )
         AND COALESCE(NULLIF(TRIM(counter_close_status), ''), 'PENDING') = 'PENDING'`,
      params,
    );
    return rows[0] ?? { receipt_cash: 0, receipt_card: 0, receipt_count: 0 };
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') {
      return { receipt_cash: 0, receipt_card: 0, receipt_count: 0 };
    }
    throw e;
  }
}

/** Mark pending credit receipts as closed after Z Report. */
export async function markCreditReceiptsAsClosed(client, { companyId, stationId, counterNo, staffId, closeId, allStaff = false }) {
  try {
    const params = [String(closeId), companyId, stationId, counterNo];
    let staffClause = '';
    if (!allStaff) {
      params.push(String(staffId));
      staffClause = 'AND created_by::text = TRIM($5::text)';
    }
    await client.query(
      `UPDATE accounts.cash_transaction_master
       SET counter_close_status = $1, modified_on = NOW()
       WHERE company_id = $2
         AND branch_id  = $3
         AND counter_no = $4
         ${staffClause}
         AND UPPER(COALESCE(status, 'ACTIVE')) = 'ACTIVE'
         AND UPPER(COALESCE(transaction_type, '')) IN (
           'CUSTOMER RECEIPT', 'CUSTOMER_RECEIPT', 'RECEIPT'
         )
         AND COALESCE(NULLIF(TRIM(counter_close_status), ''), 'PENDING') = 'PENDING'`,
      params,
    );
  } catch (e) {
    if (e.code !== '42P01' && e.code !== '42703') throw e;
  }
}

/** Credit receipts linked to a completed counter close (by close id). */
export async function getCreditReceiptTotalsForClose(pool, companyId, closeId) {
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (
           WHERE UPPER(TRIM(COALESCE(payment_mode, ''))) = 'CASH'
         ), 0) AS receipt_cash,
         COALESCE(SUM(amount) FILTER (
           WHERE UPPER(TRIM(COALESCE(payment_mode, ''))) IN ('CARD', 'CREDITCARD')
         ), 0) AS receipt_card,
         COUNT(*)::INT AS receipt_count
       FROM accounts.cash_transaction_master
       WHERE company_id = $1
         AND TRIM(COALESCE(counter_close_status, '')) = TRIM($2::text)
         AND UPPER(COALESCE(status, 'ACTIVE')) = 'ACTIVE'
         AND UPPER(COALESCE(transaction_type, '')) IN (
           'CUSTOMER RECEIPT', 'CUSTOMER_RECEIPT', 'RECEIPT'
         )`,
      [companyId, String(closeId)],
    );
    return rows[0] ?? { receipt_cash: 0, receipt_card: 0, receipt_count: 0 };
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') {
      return { receipt_cash: 0, receipt_card: 0, receipt_count: 0 };
    }
    throw e;
  }
}

/** SUM of cash in / cash out for this session (PENDING only) */
export async function getCashInOutTotals(pool, { companyId, stationId, counterNo, staffId, allStaff = false }) {
  const params = [companyId, stationId, counterNo];
  let staffClause = '';
  if (!allStaff) {
    params.push(staffId);
    staffClause = `AND staff_id = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN transaction_type = 'CASH_IN'  THEN amount ELSE 0 END), 0) AS cash_in,
       COALESCE(SUM(CASE WHEN transaction_type = 'CASH_OUT' THEN amount ELSE 0 END), 0) AS cash_out
     FROM ops.cash_in_out
     WHERE company_id  = $1
       AND station_id  = $2
       AND counter_no  = $3
       ${staffClause}
       AND close_status = 'PENDING'`,
    params,
  );
  return rows[0];
}

/**
 * Get next Z Report sequence number for this company.
 * Parses existing close_no values like "Z-C1-0003" to find max seq.
 */
export async function getNextCloseSeq(client, companyId) {
  await client.query(
    `SELECT id FROM ops.counter_close WHERE company_id = $1 FOR UPDATE`,
    [companyId],
  ).catch((e) => {
    if (e.code !== '42P01') throw e;
  });
  const { rows } = await client.query(
    `SELECT COALESCE(
       MAX(
         CASE
           WHEN close_no ~ '^Z-C[0-9]+-[0-9]+$'
           THEN CAST(SPLIT_PART(close_no, '-', 3) AS INTEGER)
           ELSE NULL
         END
       ),
       0
     ) + 1 AS next_seq
     FROM ops.counter_close
     WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].next_seq);
}

/** Insert a counter close record. Returns the new row id and close_no. */
export async function insertCounterClose(client, data) {
  const baseParams = [
    data.companyId, data.branchId, data.stationId ?? data.branchId, data.counterNo, data.staffId, data.reportType,
    data.totalCash, data.totalCredit, data.totalCard, data.totalDiscount,
    data.totalRefund, data.totalRoundOff, data.totalTax, data.grossAmount,
    data.cashIn, data.cashOut,
    data.cashToBeCollected, data.collectedCash, data.cashDifference,
    data.billCount, data.startBillNo ?? null, data.endBillNo ?? null,
    data.closeNo ?? null,
  ];
  const receiptParams = [
    data.creditReceiptCash ?? 0,
    data.creditReceiptCard ?? 0,
    data.creditReceiptCount ?? 0,
  ];
  try {
    await client.query('SAVEPOINT counter_close_insert');
    const { rows } = await client.query(
      `INSERT INTO ops.counter_close (
         company_id, branch_id, station_id, counter_no, staff_id, report_type, close_date,
         total_cash, total_credit, total_card, total_discount,
         total_refund, total_round_off, total_tax, gross_amount,
         cash_in, cash_out,
         cash_to_be_collected, collected_cash, cash_difference,
         bill_count, start_bill_no, end_bill_no, close_no,
         credit_receipt_cash, credit_receipt_card, credit_receipt_count
       ) VALUES (
         $1,$2,$3,$4,$5,$6,NOW(),
         $7,$8,$9,$10,
         $11,$12,$13,$14,
         $15,$16,
         $17,$18,$19,
         $20,$21,$22,$23,
         $24,$25,$26
       ) RETURNING id, close_no`,
      [...baseParams, ...receiptParams],
    );
    await client.query('RELEASE SAVEPOINT counter_close_insert');
    return { id: rows[0].id, closeNo: rows[0].close_no };
  } catch (e) {
    if (e.code !== '42703') throw e;
    await client.query('ROLLBACK TO SAVEPOINT counter_close_insert');
    const { rows } = await client.query(
      `INSERT INTO ops.counter_close (
         company_id, branch_id, station_id, counter_no, staff_id, report_type, close_date,
         total_cash, total_credit, total_card, total_discount,
         total_refund, total_round_off, total_tax, gross_amount,
         cash_in, cash_out,
         cash_to_be_collected, collected_cash, cash_difference,
         bill_count, start_bill_no, end_bill_no, close_no
       ) VALUES (
         $1,$2,$3,$4,$5,$6,NOW(),
         $7,$8,$9,$10,
         $11,$12,$13,$14,
         $15,$16,
         $17,$18,$19,
         $20,$21,$22,$23
       ) RETURNING id, close_no`,
      baseParams,
    );
    return { id: rows[0].id, closeNo: rows[0].close_no ?? data.closeNo ?? null };
  }
}

/** Mark all PENDING sales for this session as closed with the close record id */
export async function markSalesAsClosed(client, { companyId, stationId, counterNo, staffId, closeId, allStaff = false }) {
  const params = [String(closeId), companyId, stationId, counterNo];
  let staffClause = '';
  if (!allStaff) {
    params.push(staffId);
    staffClause = `AND staff_id = $${params.length}`;
  }
  const sql = `
    UPDATE ops.sales_master
    SET counter_close_status = $1, modified_at = NOW()
    WHERE company_id           = $2
      AND station_id           = $3
      AND counter_no           = $4
      ${staffClause}
      AND COALESCE(NULLIF(TRIM(counter_close_status), ''), 'PENDING') = 'PENDING'
      AND post_status          = 'POSTED'
       AND UPPER(COALESCE(hold_status, '')) NOT IN ('HOLD', 'DELIVERY')`;
  try {
    await client.query('SAVEPOINT sales_close_update');
    const { rowCount } = await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT sales_close_update');
    return rowCount;
  } catch (e) {
    if (e.code !== '42703') throw e;
    await client.query('ROLLBACK TO SAVEPOINT sales_close_update');
    const { rowCount } = await client.query(
      sql.replace('modified_at', 'modified_on'),
      params,
    );
    return rowCount;
  }
}

/** Mark all PENDING cash in/out entries as closed */
export async function markCashInOutAsClosed(client, { companyId, stationId, counterNo, staffId, closeId, allStaff = false }) {
  const params = [closeId, companyId, stationId, counterNo];
  let staffClause = '';
  if (!allStaff) {
    params.push(staffId);
    staffClause = `AND staff_id = $${params.length}`;
  }
  await client.query(
    `UPDATE ops.cash_in_out
     SET close_status = 'CLOSED', counter_close_id = $1
     WHERE company_id  = $2
       AND station_id  = $3
       AND counter_no  = $4
       ${staffClause}
       AND close_status = 'PENDING'`,
    params,
  );
}

/** Insert a cash in or cash out entry */
export async function insertCashInOut(pool, { companyId, branchId, stationId, counterNo, staffId, transactionType, amount, remarks }) {
  const { rows } = await pool.query(
    `INSERT INTO ops.cash_in_out (
       company_id, branch_id, station_id, counter_no, staff_id,
       transaction_type, amount, remarks
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, transaction_type, amount, remarks, created_at`,
    [companyId, branchId, stationId ?? branchId, counterNo, staffId, transactionType, amount, remarks ?? null],
  );
  return rows[0];
}

/** List cash in/out linked to a completed counter close */
export async function getCashInOutByCloseId(pool, { companyId, closeId }) {
  try {
    const { rows } = await pool.query(
      `SELECT id, transaction_type, amount, remarks, created_at
       FROM ops.cash_in_out
       WHERE company_id = $1 AND counter_close_id = $2
       ORDER BY created_at`,
      [companyId, closeId],
    );
    return rows;
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return [];
    throw e;
  }
}

/** List cash in/out for current session */
export async function getCashInOutList(pool, { companyId, stationId, counterNo, staffId, allStaff = false }) {
  const params = [companyId, stationId, counterNo];
  let staffClause = '';
  if (!allStaff) {
    params.push(staffId);
    staffClause = `AND staff_id = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT id, transaction_type, amount, remarks, created_at
     FROM ops.cash_in_out
     WHERE company_id  = $1
       AND station_id  = $2
       AND counter_no  = $3
       ${staffClause}
       AND close_status = 'PENDING'
     ORDER BY created_at`,
    params,
  );
  return rows;
}

/**
 * Cash in/out report with filters (date range, counter, close no).
 * Returns rows + summary totals for the same filter set.
 */
export async function listCashInOutReport(pool, {
  companyId, stationId, counterNo, dateFrom, dateTo, closeNo, limit,
}) {
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const today = new Date().toISOString().slice(0, 10);
  const from = dateFrom || today;
  const to = dateTo || today;
  const params = [companyId, stationId, from, to];
  let counterClause = '';
  let closeClause = '';

  if (counterNo != null && counterNo !== '' && Number.isFinite(Number(counterNo))) {
    params.push(Number(counterNo));
    counterClause = ` AND cio.counter_no = $${params.length}`;
  }

  const closeTrim = String(closeNo ?? '').trim();
  if (closeTrim) {
    params.push(closeTrim.toUpperCase() === 'PENDING' ? 'PENDING' : `%${closeTrim}%`);
    if (closeTrim.toUpperCase() === 'PENDING') {
      closeClause = ` AND cio.close_status = 'PENDING'`;
    } else {
      closeClause = ` AND COALESCE(cc.close_no, '') ILIKE $${params.length}`;
    }
  }

  params.push(lim);
  const limitParam = `$${params.length}`;

  const baseFrom = `
    FROM ops.cash_in_out cio
    LEFT JOIN ops.counter_close cc
      ON cc.company_id = cio.company_id AND cc.id = cio.counter_close_id
    LEFT JOIN core.staff_master st
      ON st.company_id = cio.company_id AND st.staff_id = cio.staff_id
    WHERE cio.company_id = $1
      AND cio.station_id = $2
      AND cio.created_at::date >= $3::date
      AND cio.created_at::date <= $4::date
      ${counterClause}
      ${closeClause}`;

  try {
    const { rows } = await pool.query(
      `SELECT
         cio.id,
         cio.transaction_type,
         cio.amount,
         cio.remarks,
         cio.created_at,
         cio.counter_no,
         cio.close_status,
         CASE
           WHEN cio.close_status = 'PENDING' THEN 'PENDING'
           ELSE COALESCE(cc.close_no, CAST(cio.counter_close_id AS TEXT))
         END AS counter_close_no,
         cio.counter_close_id,
         st.staff_name
       ${baseFrom}
       ORDER BY cio.created_at DESC, cio.id DESC
       LIMIT ${limitParam}`,
      params,
    );

    const { rows: sumRows } = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN cio.transaction_type = 'CASH_IN'  THEN cio.amount ELSE 0 END), 0) AS total_cash_in,
         COALESCE(SUM(CASE WHEN cio.transaction_type = 'CASH_OUT' THEN cio.amount ELSE 0 END), 0) AS total_cash_out,
         COUNT(*)::INT AS entry_count,
         COALESCE(SUM(CASE WHEN cio.transaction_type = 'CASH_IN'  THEN 1 ELSE 0 END), 0)::INT AS cash_in_count,
         COALESCE(SUM(CASE WHEN cio.transaction_type = 'CASH_OUT' THEN 1 ELSE 0 END), 0)::INT AS cash_out_count
       ${baseFrom}`,
      params.slice(0, -1),
    );

    return { rows, summary: sumRows[0] ?? {} };
  } catch (e) {
    if (e.code === '42P01') {
      return {
        rows: [],
        summary: {
          total_cash_in: 0, total_cash_out: 0, entry_count: 0,
          cash_in_count: 0, cash_out_count: 0,
        },
      };
    }
    throw e;
  }
}

const RECEIPT_LATERAL_JOIN = `
     LEFT JOIN LATERAL (
       SELECT
         COALESCE(SUM(ctm.amount) FILTER (
           WHERE UPPER(TRIM(COALESCE(ctm.payment_mode, ''))) = 'CASH'
         ), 0) AS receipt_cash,
         COALESCE(SUM(ctm.amount) FILTER (
           WHERE UPPER(TRIM(COALESCE(ctm.payment_mode, ''))) IN ('CARD', 'CREDITCARD')
         ), 0) AS receipt_card,
         COUNT(*)::INT AS receipt_count
       FROM accounts.cash_transaction_master ctm
       WHERE ctm.company_id = cc.company_id
         AND TRIM(COALESCE(ctm.counter_close_status, '')) = TRIM(cc.id::text)
         AND UPPER(COALESCE(ctm.status, 'ACTIVE')) = 'ACTIVE'
         AND UPPER(COALESCE(ctm.transaction_type, '')) IN (
           'CUSTOMER RECEIPT', 'CUSTOMER_RECEIPT', 'RECEIPT'
         )
     ) rc ON true`;

/** List past counter closes (history) with optional date range. */
export async function getCloseHistory(pool, {
  companyId, stationId, counterNo, staffId, dateFrom, dateTo, limit,
  allStaff = false,
}) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const today = new Date().toISOString().slice(0, 10);
  const from = dateFrom || today;
  const to = dateTo || today;
  const params = [companyId, stationId, counterNo, from, to];
  let staffClause = '';
  if (!allStaff) {
    params.push(staffId);
    staffClause = `AND cc.staff_id = $${params.length}`;
  }
  params.push(lim);
  const where = `
     WHERE cc.company_id = $1
       AND cc.station_id = $2
       AND cc.counter_no = $3
       AND cc.close_date::date >= $4::date
       AND cc.close_date::date <= $5::date
       ${staffClause}
     ORDER BY cc.close_date DESC, cc.id DESC
     LIMIT $${params.length}`;

  const fullSql = `
    SELECT cc.id, cc.close_no, cc.report_type, cc.close_date, cc.counter_no,
           cc.total_cash, cc.total_credit, cc.total_card, cc.gross_amount,
           cc.cash_to_be_collected, cc.collected_cash, cc.cash_difference,
           cc.bill_count, cc.start_bill_no, cc.end_bill_no,
           cc.credit_receipt_cash, cc.credit_receipt_card, cc.credit_receipt_count,
           st.staff_name,
           COALESCE(rc.receipt_cash, 0)  AS linked_receipt_cash,
           COALESCE(rc.receipt_card, 0)  AS linked_receipt_card,
           COALESCE(rc.receipt_count, 0) AS linked_receipt_count
    FROM ops.counter_close cc
    LEFT JOIN core.staff_master st
      ON st.company_id = cc.company_id AND st.staff_id = cc.staff_id
    ${RECEIPT_LATERAL_JOIN}
    ${where}`;

  try {
    const { rows } = await pool.query(fullSql, params);
    return rows;
  } catch (e) {
    if (e.code !== '42703') throw e;
    const { rows } = await pool.query(
      `SELECT cc.id, cc.close_no, cc.report_type, cc.close_date, cc.counter_no,
              cc.total_cash, cc.total_credit, cc.total_card, cc.gross_amount,
              cc.cash_to_be_collected, cc.collected_cash, cc.cash_difference,
              cc.bill_count, cc.start_bill_no, cc.end_bill_no,
              st.staff_name,
              COALESCE(rc.receipt_cash, 0)  AS linked_receipt_cash,
              COALESCE(rc.receipt_card, 0)  AS linked_receipt_card,
              COALESCE(rc.receipt_count, 0) AS linked_receipt_count
       FROM ops.counter_close cc
       LEFT JOIN core.staff_master st
         ON st.company_id = cc.company_id AND st.staff_id = cc.staff_id
       ${RECEIPT_LATERAL_JOIN}
       ${where}`,
      params,
    );
    return rows;
  }
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
