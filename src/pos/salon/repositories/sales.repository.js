/**
 * ops.sales_master / sales_child / sales_payment_split writes for Salon POS.
 *
 * Separate from the restaurant repository rather than shared, for two reasons:
 *   - entry_source is written as 'SALON-POS', which is how reports tell salon
 *     bills apart from restaurant ones in the same table;
 *   - needs job_id on the master and stylist_id / line_type on
 *     each line, and threading three nullable salon columns through the
 *     restaurant writer would put salon concerns in a hot restaurant path.
 *
 * Id allocation (nextSalesId / nextSalesChildId / nextBillNo) deliberately
 * mirrors the restaurant repository, including its MAX+1 approach. These ids
 * are per company and the callers hold an advisory lock for the whole
 * transaction, so concurrent tills cannot interleave. bill_no stays a plain
 * integer because the Flutter printing and receipt code parses it as one â€” see
 * the documented exception in api/CLAUDE.md.
 * After a successful settle, job rows are hard-deleted (migration 106 drops FKs).
 */
import {
  PM,
  isCreditCardBillMode,
  isCreditBillMode,
  isComplimentBillMode,
  isOnlineBillMode,
  isMultiPaymentBillMode,
  normalizeBillPaymentMode,
} from '../utils/paymentModes.js';

export async function nextSalesId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(sales_id), 0) + 1 AS n FROM ops.sales_master WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].n);
}

export async function nextSalesChildId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(sales_child_id), 0) + 1 AS n FROM ops.sales_child WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].n);
}

export async function nextBillNo(client, companyId, stationId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(bill_no), 0) + 1 AS n
       FROM ops.sales_master
      WHERE company_id = $1 AND station_id = $2`,
    [companyId, stationId]
  );
  return Number(rows[0].n);
}

export async function findJobForSettlement(client, companyId, jobId) {
  const { rows } = await client.query(
    `SELECT job_id, job_no, job_status, station_id, branch_id,
            chair_id, area_id, customer_id, primary_stylist_id, sales_id
       FROM ops.job_master
      WHERE company_id = $1 AND job_id = $2 AND is_deleted = FALSE
      FOR UPDATE`,
    [companyId, jobId]
  );
  return rows[0] ?? null;
}

/**
 * Job lines keyed by line_id, used to fill in stylist_id / line_type for a
 * settlement line when the client did not send them. The job is the source of
 * truth for who performed a service â€” a client that omits the stylist must not
 * silently produce a bill with no one credited.
 */
export async function listJobLinesForSettlement(client, companyId, jobId) {
  const { rows } = await client.query(
    `SELECT line_id, product_id, line_type, stylist_id
       FROM ops.job_child
      WHERE company_id = $1 AND job_id = $2 AND is_deleted = FALSE`,
    [companyId, jobId]
  );
  return rows;
}

/** Hard-delete job child then master after sales insert completes.
 *  sales_master.job_id stays as a historical reference (no FK).
 */
export async function ensureNoSalesJobFk(client) {
  await client.query(
    `ALTER TABLE ops.sales_master DROP CONSTRAINT IF EXISTS fk_sales_master_salon_job`
  );
  await client.query(
    `ALTER TABLE ops.sales_master DROP CONSTRAINT IF EXISTS fk_sales_master_job`
  );
  await client.query(
    `ALTER TABLE ops.job_master DROP CONSTRAINT IF EXISTS fk_job_master_sales`
  );
  await client.query(
    `ALTER TABLE ops.job_master DROP CONSTRAINT IF EXISTS fk_salon_job_master_sales`
  );
}

export async function deleteJobAfterSettlement(client, companyId, jobId) {
  // Drop FKs that would block job delete after bill insert (idempotent).
  await ensureNoSalesJobFk(client);

  await client.query(
    `DELETE FROM ops.job_child
      WHERE company_id = $1 AND job_id = $2`,
    [companyId, jobId]
  );
  const { rowCount } = await client.query(
    `DELETE FROM ops.job_master
      WHERE company_id = $1 AND job_id = $2`,
    [companyId, jobId]
  );
  return rowCount > 0;
}

export function resolveSalesOutstandingBalance(m) {
  const mode = normalizeBillPaymentMode(m.paymentMode);
  const net = Number(m.amount ?? m.netAmount ?? 0);
  if (mode === PM.CREDIT) return net > 0 ? net : 0;
  if (isMultiPaymentBillMode(mode)) {
    const credit = m.creditAmount != null ? Number(m.creditAmount) : 0;
    return credit > 0 ? credit : 0;
  }
  return 0;
}

export async function insertSalesMaster(client, row) {
  const {
    companyId, salesId, branchId, stationId, jobId, counterNo, billNo,
    customerId, paymentMode, creditCardNo,
    amount, cashAmount, creditAmount, creditCardAmount, paidAmount, balancePaid,
    discountAmount, subtotalAmount, taxableAmount,
    tax1Amount, tax2Amount, tax3Amount, tax1Rate, tax2Rate, tax3Rate,
    roundOffAdj, stylistId, chairId, areaId, noOfCustomers,
    staffId, remarks, onlineSource, createdBy, modifiedBy,
  } = row;

  const mode = normalizeBillPaymentMode(paymentMode);
  const paid = Number(paidAmount ?? 0);
  const net = Number(amount ?? 0);

  const cashAmt = cashAmount != null
    ? Number(cashAmount)
    : (mode === PM.CASH ? paid : 0);
  const creditAmt = creditAmount != null
    ? Number(creditAmount)
    : (isCreditBillMode(mode) ? net : 0);
  const cardAmt = creditCardAmount != null
    ? Number(creditCardAmount)
    : ((isCreditCardBillMode(mode) || isOnlineBillMode(mode)) ? paid : 0);

  const osBal = resolveSalesOutstandingBalance({
    paymentMode: mode,
    amount: net,
    creditAmount: creditAmt,
  });

  const remarkText = [remarks, onlineSource ? `Online: ${onlineSource}` : null]
    .filter(Boolean)
    .join(' | ')
    .slice(0, 200) || null;

  await client.query(
    `INSERT INTO ops.sales_master (
        company_id, sales_id, branch_id, station_id, job_id,
        counter_no, bill_no, bill_date, bill_time,
        customer_id, payment_mode, credit_card_no,
        amount, cash_amount, credit_amount, credit_card_amount,
        paid_amount, balance_paid, outstanding_balance,
        discount_amount, subtotal_amount, taxable_amount,
        tax_1_amount, tax_2_amount, tax_3_amount,
        tax_1_rate, tax_2_rate, tax_3_rate,
        round_off_adjustment,
        waiter_id, table_id, area_id, no_of_customers,
        staff_id, remarks, entry_source, post_status,
        counter_close_status, created_by, modified_by
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7, NOW(), NOW(),
        $8,$9,$10,
        $11,$12,$13,$14,
        $15,$16,$17,
        $18,$19,$20,
        $21,$22,$23,
        $24,$25,$26,
        $27,
        $28,$29,$30,$31,
        $32,$33,'SALON-POS','POSTED',
        'PENDING',$34,$35
      )`,
    [
      companyId, salesId, branchId, stationId ?? branchId, jobId,
      counterNo, billNo,
      customerId, mode, creditCardNo,
      net, cashAmt, creditAmt, cardAmt,
      isComplimentBillMode(mode) ? 0 : paid,
      isComplimentBillMode(mode) ? 0 : Number(balancePaid ?? 0),
      osBal,
      discountAmount, subtotalAmount, taxableAmount,
      tax1Amount, tax2Amount, tax3Amount, tax1Rate, tax2Rate, tax3Rate,
      roundOffAdj,
      stylistId, chairId, areaId, noOfCustomers,
      staffId, remarkText, createdBy, modifiedBy,
    ]
  ).catch(async (e) => {
    // Older DBs may still have salon_job_id instead of job_id.
    if (e.code !== '42703' || !String(e.message || '').includes('job_id')) throw e;
    await client.query(
      `INSERT INTO ops.sales_master (
          company_id, sales_id, branch_id, station_id, salon_job_id,
          counter_no, bill_no, bill_date, bill_time,
          customer_id, payment_mode, credit_card_no,
          amount, cash_amount, credit_amount, credit_card_amount,
          paid_amount, balance_paid, outstanding_balance,
          discount_amount, subtotal_amount, taxable_amount,
          tax_1_amount, tax_2_amount, tax_3_amount,
          tax_1_rate, tax_2_rate, tax_3_rate,
          round_off_adjustment,
          waiter_id, table_id, area_id, no_of_customers,
          staff_id, remarks, entry_source, post_status,
          counter_close_status, created_by, modified_by
        ) VALUES (
          $1,$2,$3,$4,$5,
          $6,$7, NOW(), NOW(),
          $8,$9,$10,
          $11,$12,$13,$14,
          $15,$16,$17,
          $18,$19,$20,
          $21,$22,$23,
          $24,$25,$26,
          $27,
          $28,$29,$30,$31,
          $32,$33,'SALON-POS','POSTED',
          'PENDING',$34,$35
        )`,
      [
        companyId, salesId, branchId, stationId ?? branchId, jobId,
        counterNo, billNo,
        customerId, mode, creditCardNo,
        net, cashAmt, creditAmt, cardAmt,
        isComplimentBillMode(mode) ? 0 : paid,
        isComplimentBillMode(mode) ? 0 : Number(balancePaid ?? 0),
        osBal,
        discountAmount, subtotalAmount, taxableAmount,
        tax1Amount, tax2Amount, tax3Amount, tax1Rate, tax2Rate, tax3Rate,
        roundOffAdj,
        stylistId, chairId, areaId, noOfCustomers,
        staffId, remarkText, createdBy, modifiedBy,
      ]
    );
  });
}

export async function insertSalesChild(client, row) {
  const {
    companyId, salesChildId, salesId, branchId, stationId,
    jobLineId, productId, shortDescription, groupId,
    qty, unitPrice, unitCost, packQty, discountAmount, lineTotal,
    tax1Amount, tax2Amount, tax3Amount, tax1Rate, tax2Rate, tax3Rate,
    subtotalAmount, stylistId, lineType, modifier, createdBy, modifiedBy,
  } = row;

  await client.query(
    `INSERT INTO ops.sales_child (
        company_id, sales_child_id, sales_id, branch_id, station_id,
        kot_child_id, product_id, short_description, group_id,
        qty, unit_price, unit_cost, pack_qty, discount_amount, line_total,
        tax_1_amount, tax_2_amount, tax_3_amount,
        tax_1_rate, tax_2_rate, tax_3_rate,
        subtotal_amount, stylist_id, line_type, modifier,
        created_by, modified_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
        $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
      )`,
    [
      companyId, salesChildId, salesId, branchId, stationId ?? branchId,
      jobLineId, productId, shortDescription, groupId,
      qty, unitPrice, unitCost, packQty, discountAmount, lineTotal,
      tax1Amount, tax2Amount, tax3Amount, tax1Rate, tax2Rate, tax3Rate,
      subtotalAmount, stylistId, lineType, modifier,
      createdBy, modifiedBy,
    ]
  );
}

export async function insertSalesPaymentSplit(client, row) {
  const {
    companyId, salesId, payerNo, payMode, billAmount, tipAmount = 0,
    branchId, counterId, staffId, refNo, creditCardTypeId = null,
  } = row;
  const counter = Number.isFinite(Number(counterId)) ? Math.trunc(Number(counterId)) : 0;
  try {
    await client.query(
      `INSERT INTO ops.sales_payment_split (
          company_id, sales_id, payer_no, pay_mode, bill_amount, tip_amount,
          branch_id, counter_id, staff_id, ref_no, credit_card_type_id,
          pay_date, is_cancelled
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW(), FALSE)`,
      [
        companyId, salesId, payerNo, payMode, billAmount, tipAmount,
        branchId, counter, staffId, refNo, creditCardTypeId,
      ]
    );
  } catch (e) {
    if (e.code !== '42703') throw e;
    await client.query(
      `INSERT INTO ops.sales_payment_split (
          company_id, sales_id, payer_no, pay_mode, bill_amount, tip_amount,
          branch_id, counter_id, staff_id, ref_no, pay_date, is_cancelled
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW(), FALSE)`,
      [
        companyId, salesId, payerNo, payMode, billAmount, tipAmount,
        branchId, counter, staffId, refNo,
      ]
    );
  }
}

export async function insertPaymentSplits(client, {
  companyId, salesId, branchId, counterNo, staffId, splits,
}) {
  let payerNo = 1;
  for (const s of splits) {
    const tipAmount = Number(s.tip ?? s.tipAmount ?? 0);
    await insertSalesPaymentSplit(client, {
      companyId,
      salesId,
      payerNo: payerNo++,
      payMode: s.payMode,
      billAmount: s.amount,
      tipAmount: Number.isFinite(tipAmount) && tipAmount > 0 ? tipAmount : 0,
      branchId,
      counterId: counterNo,
      staffId,
      refNo: s.refNo || null,
      creditCardTypeId: s.creditCardTypeId ?? null,
    });
  }
}

/**
 * Posted salon bills for Sales Viewer (date + optional text filter).
 * Scoped to entry_source = 'SALON-POS' so restaurant/counter bills never leak in.
 */
export async function listPostedSales(pool, {
  companyId, dateFrom, dateTo, filterKey, searchQuery, limit,
}) {
  const lim = Math.min(Math.max(Number(limit) || 300, 1), 500);
  const params = [companyId, dateFrom, dateTo];
  let filterClause = '';
  const q = String(searchQuery ?? '').trim();
  if (q) {
    const key = String(filterKey ?? 'CustomerName');
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    if (key === 'BillNo') {
      filterClause = ` AND (sm.bill_no::text ILIKE ${p} OR sm.sales_id::text ILIKE ${p})`;
    } else if (key === 'CounterNo') {
      filterClause = ` AND sm.counter_no::text ILIKE ${p}`;
    } else if (key === 'PaymentMode') {
      filterClause = ` AND sm.payment_mode ILIKE ${p}`;
    } else if (key === 'DeliveryBoyName') {
      filterClause = ` AND st.staff_name ILIKE ${p}`;
    } else {
      filterClause = ` AND COALESCE(cm.customer_name, '') ILIKE ${p}`;
    }
  }
  params.push(lim);

  const { rows } = await pool.query(
    `SELECT
       sm.sales_id,
       sm.bill_no,
       sm.bill_date,
       sm.bill_time,
       sm.payment_mode,
       sm.counter_no,
       sm.amount,
       sm.subtotal_amount,
       sm.taxable_amount,
       sm.tax_1_amount,
       sm.discount_amount,
       sm.round_off_adjustment,
       sm.credit_card_no,
       sm.remarks,
       sm.counter_close_status,
       cm.customer_name,
       st.staff_name,
       cc.close_no AS counter_close_no,
       COALESCE((
         SELECT SUM(COALESCE(sps.tip_amount, 0))
           FROM ops.sales_payment_split sps
          WHERE sps.company_id = sm.company_id
            AND sps.sales_id = sm.sales_id
       ), 0) AS tip_amount
     FROM ops.sales_master sm
     LEFT JOIN biz.customer_master cm
       ON cm.company_id = sm.company_id AND cm.customer_id = sm.customer_id
     LEFT JOIN LATERAL (
       SELECT s.staff_name
         FROM core.staff_master s
        WHERE s.company_id = sm.company_id
          AND (s.id = sm.staff_id OR s.staff_id = sm.staff_id)
        ORDER BY CASE WHEN s.id = sm.staff_id THEN 0 ELSE 1 END
        LIMIT 1
     ) st ON TRUE
     LEFT JOIN ops.counter_close cc
       ON cc.company_id = sm.company_id
      AND cc.id = CASE
            WHEN sm.counter_close_status ~ '^[0-9]+$' THEN sm.counter_close_status::bigint
            ELSE NULL
          END
     WHERE sm.company_id = $1
       AND sm.entry_source = 'SALON-POS'
       AND sm.post_status = 'POSTED'
       AND COALESCE(sm.hold_status, '') NOT IN ('HOLD', 'DELIVERY', 'CANCELLED')
       AND sm.bill_date::date >= $2::date
       AND sm.bill_date::date <= $3::date
       ${filterClause}
     ORDER BY sm.bill_date DESC, sm.sales_id DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

/** Single posted salon bill header + line items + payment splits. */
export async function getPostedBillDetail(pool, companyId, salesId) {
  const { rows: masters } = await pool.query(
    `SELECT
       sm.sales_id,
       sm.bill_no,
       sm.bill_date,
       sm.bill_time,
       sm.payment_mode,
       sm.counter_no,
       sm.subtotal_amount,
       sm.discount_amount,
       sm.taxable_amount,
       sm.tax_1_amount,
       sm.tax_1_rate,
       sm.round_off_adjustment,
       sm.amount,
       sm.paid_amount,
       sm.balance_paid,
       sm.cash_amount,
       sm.credit_amount,
       sm.credit_card_amount,
       sm.outstanding_balance,
       sm.credit_card_no,
       sm.remarks,
       sm.counter_close_status,
       cm.customer_id,
       cm.customer_code,
       cm.customer_name,
       st.staff_name,
       cc.close_no AS counter_close_no
     FROM ops.sales_master sm
     LEFT JOIN biz.customer_master cm
       ON cm.company_id = sm.company_id AND cm.customer_id = sm.customer_id
     LEFT JOIN LATERAL (
       SELECT s.staff_name
         FROM core.staff_master s
        WHERE s.company_id = sm.company_id
          AND (s.id = sm.staff_id OR s.staff_id = sm.staff_id)
        ORDER BY CASE WHEN s.id = sm.staff_id THEN 0 ELSE 1 END
        LIMIT 1
     ) st ON TRUE
     LEFT JOIN ops.counter_close cc
       ON cc.company_id = sm.company_id
      AND cc.id = CASE
            WHEN sm.counter_close_status ~ '^[0-9]+$' THEN sm.counter_close_status::bigint
            ELSE NULL
          END
     WHERE sm.company_id = $1
       AND sm.sales_id = $2
       AND sm.entry_source = 'SALON-POS'
       AND sm.post_status = 'POSTED'
       AND COALESCE(sm.hold_status, '') NOT IN ('HOLD', 'DELIVERY', 'CANCELLED')`,
    [companyId, salesId],
  );
  if (!masters[0]) return null;

  const { rows: items } = await pool.query(
    `SELECT
       sc.sales_child_id,
       sc.product_id,
       COALESCE(pm.product_code, pm.barcode, sc.product_id::text) AS product_code,
       sc.short_description,
       sc.qty,
       sc.unit_price,
       sc.discount_amount,
       sc.subtotal_amount,
       sc.tax_1_amount,
       sc.tax_1_rate,
       sc.line_total
     FROM ops.sales_child sc
     LEFT JOIN core.product_master pm
       ON pm.company_id = sc.company_id AND pm.product_id = sc.product_id
     WHERE sc.company_id = $1 AND sc.sales_id = $2
     ORDER BY sc.sales_child_id`,
    [companyId, salesId],
  );

  const { rows: splits } = await pool.query(
    `SELECT payer_no, pay_mode, bill_amount, tip_amount, ref_no
     FROM ops.sales_payment_split
     WHERE company_id = $1 AND sales_id = $2
     ORDER BY payer_no`,
    [companyId, salesId],
  );

  return { master: masters[0], items, splits };
}

/** Shared posted salon bill filter for aggregate reports. */
function salonPostedDateClause() {
  return `
       sm.company_id = $1
       AND sm.entry_source = 'SALON-POS'
       AND sm.post_status = 'POSTED'
       AND COALESCE(sm.hold_status, '') NOT IN ('HOLD', 'DELIVERY', 'CANCELLED')
       AND UPPER(COALESCE(sm.record_status, 'ACTIVE')) <> 'CANCELLED'
       AND sm.bill_date::date >= $2::date
       AND sm.bill_date::date <= $3::date`;
}

/**
 * Salesman-wise — one row per staff_id on sales_master.
 * net = SUM(sm.amount) — stored invoice total (do not re-derive).
 */
export async function salesmanWiseSales(pool, {
  companyId, dateFrom, dateTo, staffId,
}) {
  const params = [companyId, dateFrom, dateTo];
  let staffClause = '';
  if (staffId != null && Number.isFinite(Number(staffId)) && Number(staffId) > 0) {
    params.push(Number(staffId));
    // Settle may store staff_master.id or staff_master.staff_id — match both (Counter Close).
    staffClause = ` AND (
      sm.staff_id = $${params.length}
      OR EXISTS (
        SELECT 1 FROM core.staff_master sx
         WHERE sx.company_id = sm.company_id
           AND (sx.id = sm.staff_id OR sx.staff_id = sm.staff_id)
           AND (sx.id = $${params.length} OR sx.staff_id = $${params.length})
      )
    )`;
  }

  const { rows } = await pool.query(
    `SELECT
       sm.staff_id,
       COALESCE(
         NULLIF(TRIM(st.staff_name), ''),
         CASE WHEN sm.staff_id IS NOT NULL THEN 'Staff #' || sm.staff_id::text ELSE 'UNASSIGNED' END
       ) AS staff_name,
       COUNT(*)::int AS bill_count,
       COALESCE(SUM(sm.subtotal_amount), 0)::float8 AS subtotal,
       COALESCE(SUM(sm.discount_amount), 0)::float8 AS discount,
       COALESCE(SUM(sm.taxable_amount), 0)::float8 AS taxable,
       COALESCE(SUM(
         COALESCE(sm.tax_1_amount, 0)
         + COALESCE(sm.tax_2_amount, 0)
         + COALESCE(sm.tax_3_amount, 0)
       ), 0)::float8 AS tax,
       COALESCE(SUM(sm.round_off_adjustment), 0)::float8 AS round_off,
       COALESCE(SUM(sm.amount), 0)::float8 AS net,
       COALESCE(SUM(COALESCE(sm.cash_amount, 0)), 0)::float8 AS cash,
       COALESCE(SUM(COALESCE(sm.credit_card_amount, 0)), 0)::float8 AS card,
       COALESCE(SUM(COALESCE(sm.credit_amount, 0)), 0)::float8 AS credit
     FROM ops.sales_master sm
     LEFT JOIN LATERAL (
       SELECT s.staff_name
         FROM core.staff_master s
        WHERE s.company_id = sm.company_id
          AND (s.id = sm.staff_id OR s.staff_id = sm.staff_id)
        ORDER BY CASE WHEN s.id = sm.staff_id THEN 0 ELSE 1 END
        LIMIT 1
     ) st ON TRUE
     WHERE ${salonPostedDateClause()}
       ${staffClause}
     GROUP BY sm.staff_id, st.staff_name
     ORDER BY net DESC, staff_name ASC`,
    params,
  );
  return rows;
}

/**
 * Item-wise — one row per product (sales_child).
 * net = SUM(sc.line_total).
 */
export async function itemWiseSales(pool, {
  companyId, dateFrom, dateTo, productId,
}) {
  const params = [companyId, dateFrom, dateTo];
  let productClause = '';
  if (productId != null && Number.isFinite(Number(productId)) && Number(productId) > 0) {
    params.push(Number(productId));
    productClause = ` AND sc.product_id = $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT
       sc.product_id,
       COALESCE(pm.product_code, '') AS product_code,
       COALESCE(pm.product_name, sc.short_description, 'UNKNOWN') AS product_name,
       COALESCE(g.group_description, '') AS group_name,
       COALESCE(SUM(sc.qty), 0)::float8 AS qty,
       COALESCE(SUM(sc.subtotal_amount), 0)::float8 AS subtotal,
       COALESCE(SUM(sc.discount_amount), 0)::float8 AS discount,
       COALESCE(SUM(
         COALESCE(sc.tax_1_amount, 0)
         + COALESCE(sc.tax_2_amount, 0)
         + COALESCE(sc.tax_3_amount, 0)
       ), 0)::float8 AS tax,
       COALESCE(SUM(sc.line_total), 0)::float8 AS net
     FROM ops.sales_child sc
     JOIN ops.sales_master sm
       ON sm.company_id = sc.company_id AND sm.sales_id = sc.sales_id
     LEFT JOIN core.product_master pm
       ON pm.company_id = sc.company_id AND pm.product_id = sc.product_id
     LEFT JOIN biz.group_master g
       ON g.company_id = COALESCE(sc.company_id, pm.company_id)
      AND g.group_id = COALESCE(sc.group_id, pm.group_id)
     WHERE ${salonPostedDateClause()}
       ${productClause}
     GROUP BY
       sc.product_id,
       COALESCE(pm.product_code, ''),
       COALESCE(pm.product_name, sc.short_description, 'UNKNOWN'),
       COALESCE(g.group_description, '')
     ORDER BY net DESC, product_name ASC`,
    params,
  );
  return rows;
}

/**
 * Group-wise — one row per catalogue group.
 * net = SUM(sc.line_total). Prefer sales_child.group_id, else product_master.group_id.
 */
export async function groupWiseSales(pool, {
  companyId, dateFrom, dateTo, groupId,
}) {
  const params = [companyId, dateFrom, dateTo];
  let groupClause = '';
  if (groupId != null && Number.isFinite(Number(groupId)) && Number(groupId) > 0) {
    params.push(Number(groupId));
    groupClause = ` AND COALESCE(sc.group_id, pm.group_id) = $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT
       COALESCE(sc.group_id, pm.group_id) AS group_id,
       COALESCE(g.group_description, 'UNASSIGNED') AS group_name,
       COUNT(DISTINCT sm.sales_id)::int AS bill_count,
       COALESCE(SUM(sc.qty), 0)::float8 AS qty,
       COALESCE(SUM(sc.subtotal_amount), 0)::float8 AS subtotal,
       COALESCE(SUM(sc.discount_amount), 0)::float8 AS discount,
       COALESCE(SUM(
         COALESCE(sc.tax_1_amount, 0)
         + COALESCE(sc.tax_2_amount, 0)
         + COALESCE(sc.tax_3_amount, 0)
       ), 0)::float8 AS tax,
       COALESCE(SUM(sc.line_total), 0)::float8 AS net
     FROM ops.sales_child sc
     JOIN ops.sales_master sm
       ON sm.company_id = sc.company_id AND sm.sales_id = sc.sales_id
     LEFT JOIN core.product_master pm
       ON pm.company_id = sc.company_id AND pm.product_id = sc.product_id
     LEFT JOIN biz.group_master g
       ON g.company_id = sc.company_id
      AND g.group_id = COALESCE(sc.group_id, pm.group_id)
     WHERE ${salonPostedDateClause()}
       ${groupClause}
     GROUP BY
       COALESCE(sc.group_id, pm.group_id),
       COALESCE(g.group_description, 'UNASSIGNED')
     ORDER BY net DESC, group_name ASC`,
    params,
  );
  return rows;
}

