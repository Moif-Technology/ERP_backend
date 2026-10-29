/**
 * Counter close readings.
 * staffIds null = RptCounterCloseDetailsPending (admin, whole station).
 * staffIds set  = RptCounterCloseDetails (this cashier only).
 */
const ENTRY = 'RESTAURANT-POS';

const SALE_SQL = `UPPER(COALESCE(sm.transaction_type, '')) NOT IN ('RETURN', 'R')`;
const RET_SQL = `UPPER(COALESCE(sm.transaction_type, '')) IN ('RETURN', 'R')`;

export async function getPendingSummary(pool, { companyId, stationId, staffIds = null }) {
  const { rows } = await pool.query(
    `WITH sm AS (
       SELECT
         company_id, sales_id, station_id, staff_id, bill_no, amount, payment_mode,
         discount_amount, round_off_adjustment, tax_1_amount, transaction_type,
         cash_amount, credit_card_amount, credit_amount, no_of_customers, bill_time
       FROM ops.sales_master
       WHERE company_id = $1
         AND station_id = $2
         AND entry_source = '${ENTRY}'
         AND COALESCE(NULLIF(TRIM(counter_close_status), ''), 'PENDING') = 'PENDING'
         AND ($3::bigint[] IS NULL OR staff_id = ANY($3::bigint[]))
     ),
     bill_pay AS (
       SELECT
         sm.sales_id,
         sm.transaction_type,
         CASE
           WHEN COALESCE(split.split_rows, 0) > 0 THEN COALESCE(split.cash_amt, 0)
           WHEN UPPER(REPLACE(COALESCE(sm.payment_mode, ''), ' ', '')) = 'CASH' THEN sm.amount
           ELSE COALESCE(sm.cash_amount, 0)
         END AS cash_amt,
         CASE
           WHEN COALESCE(split.split_rows, 0) > 0
             THEN COALESCE(split.card_amt, 0)
           WHEN UPPER(REPLACE(COALESCE(sm.payment_mode, ''), ' ', '')) IN ('CARD', 'CREDITCARD')
             THEN sm.amount
           ELSE COALESCE(sm.credit_card_amount, 0)
         END AS card_amt,
         CASE
           WHEN COALESCE(split.split_rows, 0) > 0 THEN COALESCE(split.credit_amt, 0)
           WHEN UPPER(REPLACE(COALESCE(sm.payment_mode, ''), ' ', '')) = 'CREDIT' THEN sm.amount
           ELSE COALESCE(sm.credit_amount, 0)
         END AS credit_amt,
         CASE
           WHEN COALESCE(split.split_rows, 0) > 0 THEN COALESCE(split.online_amt, 0)
           WHEN UPPER(REPLACE(COALESCE(sm.payment_mode, ''), ' ', '')) = 'ONLINE' THEN sm.amount
           ELSE 0
         END AS online_amt,
         CASE
           WHEN COALESCE(split.split_rows, 0) > 0 THEN COALESCE(split.voucher_amt, 0)
           WHEN UPPER(REPLACE(COALESCE(sm.payment_mode, ''), ' ', '')) = 'VOUCHER' THEN sm.amount
           ELSE 0
         END AS voucher_amt,
         CASE
           WHEN UPPER(REPLACE(COALESCE(sm.payment_mode, ''), ' ', '')) IN ('COMPLIMENT', 'COMPLIMENTARY')
             THEN sm.amount
           ELSE 0
         END AS compliment_amt,
         COALESCE(split.tip_amt, 0) AS tip_amt,
         COALESCE(split.cash_tip_amt, 0) AS cash_tip_amt,
         COALESCE(split.card_tip_amt, 0) AS card_tip_amt,
         COALESCE(split.online_tip_amt, 0) AS online_tip_amt
       FROM sm
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::INT AS split_rows,
           COALESCE(SUM(sps.bill_amount) FILTER (
             WHERE UPPER(TRIM(COALESCE(sps.pay_mode, ''))) = 'CASH'
           ), 0) AS cash_amt,
           COALESCE(SUM(sps.bill_amount) FILTER (
             WHERE UPPER(REPLACE(TRIM(COALESCE(sps.pay_mode, '')), ' ', '')) IN ('CARD', 'CREDITCARD')
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
             WHERE UPPER(REPLACE(TRIM(COALESCE(sps.pay_mode, '')), ' ', '')) IN ('CARD', 'CREDITCARD')
           ), 0) AS card_tip_amt,
           COALESCE(SUM(COALESCE(sps.tip_amount, 0)) FILTER (
             WHERE UPPER(TRIM(COALESCE(sps.pay_mode, ''))) = 'ONLINE'
           ), 0) AS online_tip_amt
         FROM ops.sales_payment_split sps
         WHERE sps.company_id = sm.company_id AND sps.sales_id = sm.sales_id
           AND COALESCE(sps.is_cancelled, false) = false
       ) split ON true
     )
     SELECT
       COALESCE((
         SELECT SUM(CASE WHEN UPPER(COALESCE(transaction_type, '')) IN ('RETURN', 'R') THEN 0 ELSE cash_amt END)
         FROM bill_pay
       ), 0) AS total_cash,
       COALESCE((
         SELECT SUM(CASE WHEN UPPER(COALESCE(transaction_type, '')) IN ('RETURN', 'R') THEN 0 ELSE credit_amt END)
         FROM bill_pay
       ), 0) AS total_credit,
       COALESCE((
         SELECT SUM(CASE WHEN UPPER(COALESCE(transaction_type, '')) IN ('RETURN', 'R') THEN 0 ELSE card_amt END)
         FROM bill_pay
       ), 0) AS total_card,
       COALESCE((
         SELECT SUM(CASE WHEN UPPER(COALESCE(transaction_type, '')) IN ('RETURN', 'R') THEN 0 ELSE online_amt END)
         FROM bill_pay
       ), 0) AS total_online,
       COALESCE((
         SELECT SUM(CASE WHEN UPPER(COALESCE(transaction_type, '')) IN ('RETURN', 'R') THEN 0 ELSE voucher_amt END)
         FROM bill_pay
       ), 0) AS total_voucher,
       COALESCE((
         SELECT SUM(CASE WHEN UPPER(COALESCE(transaction_type, '')) IN ('RETURN', 'R') THEN 0 ELSE compliment_amt END)
         FROM bill_pay
       ), 0) AS total_compliment,
       COALESCE((
         SELECT SUM(sc.discount_amount)
         FROM ops.sales_child sc
         INNER JOIN sm ON sm.sales_id = sc.sales_id AND sm.company_id = sc.company_id
         WHERE sm.amount > 0
       ), 0) AS item_discount_total,
       COALESCE(SUM(CASE WHEN ${SALE_SQL} THEN sm.discount_amount ELSE 0 END), 0) AS total_discount,
       COALESCE(SUM(CASE WHEN ${SALE_SQL} THEN sm.round_off_adjustment ELSE 0 END), 0) AS total_round_off,
       COALESCE(SUM(CASE WHEN ${SALE_SQL} THEN sm.tax_1_amount ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN ${RET_SQL} THEN sm.tax_1_amount ELSE 0 END), 0) AS total_tax,
       COALESCE((
         SELECT SUM(CASE WHEN UPPER(COALESCE(transaction_type, '')) IN ('RETURN', 'R') THEN 0 ELSE tip_amt END)
         FROM bill_pay
       ), 0) AS total_tip,
       COALESCE((
         SELECT SUM(CASE WHEN UPPER(COALESCE(transaction_type, '')) IN ('RETURN', 'R') THEN 0 ELSE cash_tip_amt END)
         FROM bill_pay
       ), 0) AS total_cash_tip,
       COALESCE((
         SELECT SUM(CASE WHEN UPPER(COALESCE(transaction_type, '')) IN ('RETURN', 'R') THEN 0 ELSE card_tip_amt END)
         FROM bill_pay
       ), 0) AS total_card_tip,
       COALESCE((
         SELECT SUM(CASE WHEN UPPER(COALESCE(transaction_type, '')) IN ('RETURN', 'R') THEN 0 ELSE online_tip_amt END)
         FROM bill_pay
       ), 0) AS total_online_tip,
       COALESCE((
         SELECT SUM(CASE WHEN UPPER(COALESCE(transaction_type, '')) IN ('RETURN', 'R') THEN cash_amt ELSE 0 END)
         FROM bill_pay
       ), 0) AS total_refund,
       COALESCE(SUM(sm.no_of_customers), 0) AS no_of_customers,
       COUNT(*) FILTER (WHERE ${SALE_SQL} AND sm.amount > 0)::INT AS bill_count,
       COUNT(*) FILTER (WHERE ${SALE_SQL} AND sm.amount > 0
         AND UPPER(REPLACE(COALESCE(sm.payment_mode, ''), ' ', '')) = 'CASH')::INT AS cash_bill_count,
       COUNT(*) FILTER (WHERE ${SALE_SQL} AND sm.amount > 0
         AND UPPER(REPLACE(COALESCE(sm.payment_mode, ''), ' ', '')) = 'CREDIT')::INT AS credit_bill_count,
       COUNT(*) FILTER (WHERE ${SALE_SQL} AND sm.amount > 0
         AND UPPER(REPLACE(COALESCE(sm.payment_mode, ''), ' ', '')) IN ('CARD', 'CREDITCARD'))::INT AS card_bill_count,
       COUNT(*) FILTER (WHERE ${SALE_SQL} AND sm.amount > 0
         AND UPPER(REPLACE(COALESCE(sm.payment_mode, ''), ' ', '')) = 'ONLINE')::INT AS online_bill_count,
       COUNT(*) FILTER (WHERE ${SALE_SQL} AND sm.amount > 0
         AND UPPER(REPLACE(COALESCE(sm.payment_mode, ''), ' ', '')) IN ('MULTI', 'MULTIPAYMENT', 'SPLITPAY'))::INT AS multi_bill_count,
       COUNT(*) FILTER (WHERE ${SALE_SQL} AND sm.amount > 0
         AND UPPER(REPLACE(COALESCE(sm.payment_mode, ''), ' ', '')) IN ('COMPLIMENT', 'COMPLIMENTARY'))::INT AS compliment_bill_count,
       MIN(sm.bill_no) FILTER (WHERE ${SALE_SQL} AND sm.amount > 0) AS start_bill_no,
       MAX(sm.bill_no) FILTER (WHERE ${SALE_SQL} AND sm.amount > 0) AS end_bill_no,
       MIN(sm.bill_time) FILTER (WHERE ${SALE_SQL} AND sm.amount > 0) AS start_bill_time,
       MAX(sm.bill_time) FILTER (WHERE ${SALE_SQL} AND sm.amount > 0) AS end_bill_time
     FROM sm`,
    [companyId, stationId, staffIds],
  );
  return rows[0] ?? {};
}

/** CARD SALES DETAILS — one row per credit card type (Visa, Mastercard, …). */
export async function getCardTypeSummary(pool, { companyId, stationId, staffIds = null }) {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(NULLIF(TRIM(ct.credit_card_name), ''), 'OTHERS') AS card_name,
       COUNT(*)::INT AS bill_count,
       COALESCE(SUM(sm.credit_card_amount), 0) AS amount
     FROM ops.sales_master sm
     LEFT JOIN accounts.credit_card_type_master ct
       ON ct.company_id = sm.company_id
      AND ct.credit_card_id = sm.credit_card_type_id
      AND COALESCE(ct.is_deleted, FALSE) = FALSE
     WHERE sm.company_id = $1
       AND sm.station_id = $2
       AND sm.entry_source = '${ENTRY}'
       AND COALESCE(NULLIF(TRIM(sm.counter_close_status), ''), 'PENDING') = 'PENDING'
       AND ($3::bigint[] IS NULL OR sm.staff_id = ANY($3::bigint[]))
       AND UPPER(COALESCE(sm.transaction_type, '')) NOT IN ('RETURN', 'R')
       AND COALESCE(sm.credit_card_amount, 0) > 0
     GROUP BY 1
     ORDER BY 1`,
    [companyId, stationId, staffIds],
  );
  return rows;
}

/** GeneralModuleForm.GetCounterClosePaymentModeSummary — one row per PaymentMode. */
export async function getPaymentModeSummary(pool, { companyId, stationId, staffIds = null }) {
  const { rows } = await pool.query(
    `SELECT
       UPPER(TRIM(COALESCE(payment_mode, ''))) AS pay_mode,
       COUNT(*)::INT AS bill_count,
       COALESCE(SUM(amount), 0) AS total_amt
     FROM ops.sales_master
     WHERE company_id = $1
       AND station_id = $2
       AND entry_source = '${ENTRY}'
       AND COALESCE(NULLIF(TRIM(counter_close_status), ''), 'PENDING') = 'PENDING'
       AND ($3::bigint[] IS NULL OR staff_id = ANY($3::bigint[]))
       AND UPPER(COALESCE(transaction_type, '')) NOT IN ('RETURN', 'R')
       AND amount > 0
       AND TRIM(COALESCE(payment_mode, '')) <> ''
     GROUP BY UPPER(TRIM(COALESCE(payment_mode, '')))
     ORDER BY 1`,
    [companyId, stationId, staffIds],
  );
  return rows;
}

export async function getPendingStaffBreakdown(pool, { companyId, stationId, staffIds = null }) {
  const { rows } = await pool.query(
    `SELECT
       sm.staff_id,
       COALESCE(NULLIF(TRIM(st.staff_name), ''), 'Staff #' || COALESCE(sm.staff_id::text, '0')) AS staff_name,
       COUNT(*) FILTER (WHERE sm.amount > 0)::INT AS bill_count,
       COALESCE(SUM(CASE WHEN sm.amount > 0 THEN sm.amount ELSE 0 END), 0) AS sale_amount,
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
     WHERE sm.company_id = $1
       AND sm.station_id = $2
       AND sm.entry_source = '${ENTRY}'
       AND COALESCE(NULLIF(TRIM(sm.counter_close_status), ''), 'PENDING') = 'PENDING'
       AND ($3::bigint[] IS NULL OR sm.staff_id = ANY($3::bigint[]))
     GROUP BY sm.staff_id, st.staff_name
     HAVING COUNT(*) FILTER (WHERE sm.amount > 0) > 0
     ORDER BY staff_name ASC NULLS LAST`,
    [companyId, stationId, staffIds],
  );
  return rows;
}

export async function listPendingKots(pool, { companyId, stationId }) {
  try {
    const { rows } = await pool.query(
      `SELECT kot_master_id,
              COALESCE(kot_prefix, '') AS kot_prefix,
              COALESCE(kot_number::text, '') AS kot_number,
              COALESCE(amount, 0) AS amount
         FROM ops.kot_master
        WHERE company_id = $1
          AND station_id = $2
          AND UPPER(COALESCE(kot_status, '')) NOT IN ('CANCELLED', 'COMPLETED', 'SUBMIT', 'SETTLED')
        ORDER BY kot_master_id`,
      [companyId, stationId],
    );
    return rows.map((r) => ({
      kotNo: `${r.kot_prefix || ''}${r.kot_number || ''}`,
      amount: Number(r.amount) || 0,
    }));
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return [];
    throw e;
  }
}

export async function getCashInOutTotals(pool, { companyId, stationId, staffIds = null }) {
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN transaction_type IN ('CASH_IN', 'CASH IN') THEN amount ELSE 0 END), 0) AS cash_in,
         COALESCE(SUM(CASE WHEN transaction_type IN ('CASH_OUT', 'CASH OUT') THEN amount ELSE 0 END), 0) AS cash_out
       FROM ops.cash_in_out
       WHERE company_id = $1
         AND station_id = $2
         AND COALESCE(close_status, 'PENDING') = 'PENDING'
         AND ($3::bigint[] IS NULL OR staff_id = ANY($3::bigint[]))`,
      [companyId, stationId, staffIds],
    );
    return rows[0] ?? { cash_in: 0, cash_out: 0 };
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return { cash_in: 0, cash_out: 0 };
    throw e;
  }
}

export async function getCreditReceiptTotals(pool, { companyId, counterNo, stationId, staffIds = null }) {
  const till = Number(counterNo) > 0 ? Number(counterNo) : Number(stationId);
  const params = [companyId, till];
  let staffSql = '';
  if (staffIds?.length) {
    params.push(staffIds);
    staffSql = `AND created_by = ANY($${params.length}::bigint[])`;
  }
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (
           WHERE UPPER(TRIM(COALESCE(payment_mode, ''))) = 'CASH'
         ), 0) AS receipt_cash,
         COALESCE(SUM(amount) FILTER (
           WHERE UPPER(REPLACE(TRIM(COALESCE(payment_mode, '')), ' ', '')) IN ('CARD', 'CREDITCARD')
         ), 0) AS receipt_card,
         COUNT(*)::INT AS receipt_count
       FROM accounts.cash_transaction_master
       WHERE company_id = $1
         AND counter_no = $2
         AND UPPER(COALESCE(status, 'ACTIVE')) = 'ACTIVE'
         AND UPPER(COALESCE(transaction_type, '')) IN ('CUSTOMER RECEIPT', 'CUSTOMER_RECEIPT', 'RECEIPT', 'CREDITRECEIPT')
         AND COALESCE(NULLIF(TRIM(counter_close_status), ''), 'PENDING') = 'PENDING'
         ${staffSql}`,
      params,
    );
    return rows[0] ?? { receipt_cash: 0, receipt_card: 0, receipt_count: 0 };
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703' || e.code === '42804' || e.code === '42883') {
      return { receipt_cash: 0, receipt_card: 0, receipt_count: 0 };
    }
    throw e;
  }
}

export async function getNextCloseSeq(client, { companyId, stationId, counterNo }) {
  const cn = String(counterNo ?? stationId ?? '1');
  const seqExpr = `COALESCE(
       MAX(
         CASE
           WHEN close_no ~ ('^S' || $2::text || '-[0-9]+$')
           THEN CAST(SPLIT_PART(close_no, '-', 2) AS INTEGER)
           ELSE NULL
         END
       ),
       0
     ) + 1`;
  try {
    const { rows } = await client.query(
      `SELECT ${seqExpr} AS next_seq
         FROM ops.counter_close
        WHERE company_id = $1 AND station_id = $3`,
      [companyId, cn, stationId],
    );
    return Number(rows[0]?.next_seq ?? 1);
  } catch (e) {
    if (e.code !== '42703') throw e;
    const { rows } = await client.query(
      `SELECT ${seqExpr} AS next_seq
         FROM ops.counter_close
        WHERE company_id = $1`,
      [companyId, cn],
    );
    return Number(rows[0]?.next_seq ?? 1);
  }
}

export async function getPendingWaiterBreakdown(pool, { companyId, stationId, staffIds = null }) {
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(NULLIF(TRIM(st.staff_name), ''), '—') AS waiter_name,
         COUNT(*) FILTER (WHERE sm.amount > 0)::INT AS bill_count,
         COALESCE(SUM(CASE WHEN sm.amount > 0 THEN sm.amount ELSE 0 END), 0) AS amount,
         COALESCE(SUM(tip.tip_amt), 0) AS tip_amount
       FROM ops.sales_master sm
       LEFT JOIN LATERAL (
         SELECT s.staff_name
           FROM core.staff_master s
          WHERE s.company_id = sm.company_id
            AND (s.id = sm.waiter_id OR s.staff_id = sm.waiter_id)
          ORDER BY CASE WHEN s.id = sm.waiter_id THEN 0 ELSE 1 END
          LIMIT 1
       ) st ON TRUE
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(COALESCE(sps.tip_amount, 0)), 0) AS tip_amt
           FROM ops.sales_payment_split sps
          WHERE sps.company_id = sm.company_id
            AND sps.sales_id = sm.sales_id
            AND COALESCE(sps.is_cancelled, false) = false
       ) tip ON TRUE
       WHERE sm.company_id = $1
         AND sm.station_id = $2
         AND sm.entry_source = '${ENTRY}'
         AND COALESCE(NULLIF(TRIM(sm.counter_close_status), ''), 'PENDING') = 'PENDING'
         AND UPPER(REPLACE(COALESCE(sm.payment_mode, ''), ' ', '')) NOT IN ('COMPLIMENT', 'COMPLIMENTARY')
         AND ($3::bigint[] IS NULL OR sm.staff_id = ANY($3::bigint[]))
       GROUP BY st.staff_name
       HAVING COUNT(*) FILTER (WHERE sm.amount > 0) > 0
           OR COALESCE(SUM(tip.tip_amt), 0) <> 0
       ORDER BY waiter_name ASC NULLS LAST`,
      [companyId, stationId, staffIds],
    );
    return rows;
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return [];
    throw e;
  }
}

export async function markSalesAsClosed(client, { companyId, stationId, closeNo, staffIds = null }) {
  const sql = `
    UPDATE ops.sales_master
       SET counter_close_status = $1
     WHERE company_id = $2
       AND station_id = $3
       AND entry_source = '${ENTRY}'
       AND COALESCE(NULLIF(TRIM(counter_close_status), ''), 'PENDING') = 'PENDING'
       AND ($4::bigint[] IS NULL OR staff_id = ANY($4::bigint[]))`;
  const { rowCount } = await client.query(sql, [closeNo, companyId, stationId, staffIds]);
  return rowCount;
}

export async function markSplitsAsClosed(client, { companyId, stationId, closeNo }) {
  try {
    await client.query('SAVEPOINT rest_split_close');
    const { rowCount } = await client.query(
      `UPDATE ops.sales_payment_split sps
          SET counter_close_status = $1
        WHERE sps.company_id = $2
          AND COALESCE(sps.is_cancelled, false) = false
          AND COALESCE(NULLIF(TRIM(sps.counter_close_status), ''), 'PENDING') = 'PENDING'
          AND EXISTS (
            SELECT 1 FROM ops.sales_master sm
             WHERE sm.company_id = sps.company_id
               AND sm.sales_id = sps.sales_id
               AND sm.station_id = $3
               AND sm.entry_source = '${ENTRY}'
               AND sm.counter_close_status = $1
          )`,
      [closeNo, companyId, stationId],
    );
    await client.query('RELEASE SAVEPOINT rest_split_close');
    return rowCount;
  } catch (e) {
    if (e.code === '42703' || e.code === '42P01') {
      await client.query('ROLLBACK TO SAVEPOINT rest_split_close').catch(() => {});
      return 0;
    }
    throw e;
  }
}

export async function markCashInOutAsClosed(client, { companyId, stationId, closeId, closeNo, staffIds = null }) {
  try {
    await client.query('SAVEPOINT rest_cashio_close');
    await client.query(
      `UPDATE ops.cash_in_out
          SET close_status = $1, counter_close_id = $2
        WHERE company_id = $3
          AND station_id = $4
          AND COALESCE(NULLIF(TRIM(close_status), ''), 'PENDING') = 'PENDING'
          AND ($5::bigint[] IS NULL OR staff_id = ANY($5::bigint[]))`,
      [closeNo, closeId, companyId, stationId, staffIds],
    );
    await client.query('RELEASE SAVEPOINT rest_cashio_close');
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT rest_cashio_close').catch(() => {});
    if (e.code !== '42P01' && e.code !== '42703') throw e;
  }
}

export async function markCreditReceiptsAsClosed(client, { companyId, counterNo, stationId, closeNo, staffIds = null }) {
  const till = Number(counterNo) > 0 ? Number(counterNo) : Number(stationId);
  const params = [closeNo, companyId, till];
  let staffSql = '';
  if (staffIds?.length) {
    params.push(staffIds);
    staffSql = `AND created_by = ANY($${params.length}::bigint[])`;
  }
  try {
    await client.query('SAVEPOINT rest_receipt_close');
    await client.query(
      `UPDATE accounts.cash_transaction_master
          SET counter_close_status = $1
        WHERE company_id = $2
          AND counter_no = $3
          AND UPPER(COALESCE(status, 'ACTIVE')) = 'ACTIVE'
          AND UPPER(COALESCE(transaction_type, '')) IN ('CUSTOMER RECEIPT', 'CUSTOMER_RECEIPT', 'RECEIPT', 'CREDITRECEIPT')
          AND COALESCE(NULLIF(TRIM(counter_close_status), ''), 'PENDING') = 'PENDING'
          ${staffSql}`,
      params,
    );
    await client.query('RELEASE SAVEPOINT rest_receipt_close');
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT rest_receipt_close').catch(() => {});
    if (e.code !== '42P01' && e.code !== '42703' && e.code !== '42804' && e.code !== '42883') throw e;
  }
}
