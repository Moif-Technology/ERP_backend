/**
 * Back-office reports — read-only aggregate queries.
 * Tables: ops.sales_master / sales_child, ops.purchase_master / purchase_child,
 *         biz.customer_master / supplier_master, core.product_master / product_inventory,
 *         ops.product_log_entry, accounts.voucher_master / voucher_detail / account_head_master.
 * All queries are company + branch scoped.
 */

/* ───────────────────────── SHARED SQL ───────────────────────── */

function likeParam(text) {
  return `%${String(text).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// Product-level filters ({ groupId, subGroupId, product }) on a product_master alias.
// Pushes onto params; returns SQL that starts with ' AND ' (or '').
function productFilterSql(f, params, pm = 'pm', groupExpr = null) {
  const parts = [];
  if (f.groupId != null) {
    params.push(f.groupId);
    parts.push(`${groupExpr || `${pm}.group_id`} = $${params.length}`);
  }
  if (f.subGroupId != null) {
    params.push(f.subGroupId);
    parts.push(`${pm}.subgroup_id = $${params.length}`);
  }
  if (f.product) {
    params.push(likeParam(f.product));
    const i = params.length;
    parts.push(`(${pm}.product_code ILIKE $${i} OR ${pm}.barcode ILIKE $${i} OR ${pm}.product_name ILIKE $${i})`);
  }
  return parts.length ? ` AND ${parts.join(' AND ')}` : '';
}

const SALE_RETURN_TX = `UPPER(TRIM(COALESCE(sm.transaction_type, ''))) IN ('RETURN', 'SALES RETURN', 'SALES_RETURN')`;

// Bills that count as sales: not cancelled / voided, not parked (hold / delivery).
const VALID_SALE_BILL = `UPPER(COALESCE(sm.record_status, 'ACTIVE')) <> 'CANCELLED'
        AND UPPER(COALESCE(sm.hold_status, '')) NOT IN ('HOLD', 'DELIVERY', 'CANCELLED')
        AND UPPER(COALESCE(sm.post_status, '')) <> 'CANCELLED'`;

// Bill-level payment mode normalised to CASH / CARD / CREDIT / MULTI / OTHER.
const BILL_MODE = `CASE
         WHEN UPPER(REPLACE(COALESCE(sm.payment_mode, ''), ' ', '')) IN ('CARD', 'CREDITCARD', 'CC') THEN 'CARD'
         WHEN UPPER(REPLACE(COALESCE(sm.payment_mode, ''), ' ', '')) = 'CREDIT' THEN 'CREDIT'
         WHEN UPPER(REPLACE(COALESCE(sm.payment_mode, ''), ' ', '')) IN ('MULTI', 'MULTIPAY', 'MULTIPAYMENT') THEN 'MULTI'
         WHEN UPPER(REPLACE(COALESCE(sm.payment_mode, ''), ' ', '')) IN ('', 'CASH') THEN 'CASH'
         ELSE 'OTHER' END`;

const SPLIT_MODE = `UPPER(REPLACE(COALESCE(s.pay_mode, ''), ' ', ''))`;

/**
 * CTEs `bills` (valid sale/return bills in range) and `paid` (bills + cash/card/credit/other
 * split; sales_payment_split wins for multipayment, else the bill's own mode / amount columns).
 * Amounts are ABS() — return bills are stored positive but some legacy rows are negative.
 * Params: $1 company, $2 dateFrom, $3 dateTo, then whatever `f` adds.
 * f: { branchId, stationId, paymentMode }.
 */
function salesBillsCte(f, params) {
  const parts = [];
  if (f.branchId != null) { params.push(f.branchId); parts.push(`sm.branch_id = $${params.length}`); }
  if (f.stationId != null) { params.push(f.stationId); parts.push(`sm.station_id = $${params.length}`); }
  if (f.paymentMode) { params.push(f.paymentMode); parts.push(`(${BILL_MODE}) = $${params.length}`); }
  return `bills AS (
     SELECT sm.company_id, sm.sales_id, sm.branch_id, sm.station_id, sm.counter_no,
            sm.bill_no, sm.invoice_no, sm.bill_date, sm.customer_id, sm.entry_source,
            sm.counter_close_status,
            CASE WHEN ${SALE_RETURN_TX} THEN 'RETURN' ELSE 'SALE' END AS tx,
            ${BILL_MODE} AS mode,
            ABS(COALESCE(sm.amount, 0)) AS amount,
            ABS(COALESCE(sm.subtotal_amount, 0)) AS subtotal_amount,
            ABS(COALESCE(sm.discount_amount, 0)) AS discount_amount,
            ABS(COALESCE(sm.tax_1_amount, 0) + COALESCE(sm.tax_2_amount, 0) + COALESCE(sm.tax_3_amount, 0)) AS tax_amount,
            ABS(COALESCE(sm.cash_amount, 0)) AS m_cash,
            ABS(COALESCE(sm.credit_card_amount, 0)) AS m_card,
            ABS(COALESCE(sm.credit_amount, 0)) AS m_credit,
            COALESCE(sp.split_rows, 0) AS split_rows,
            COALESCE(sp.cash_amt, 0) AS sp_cash,
            COALESCE(sp.card_amt, 0) AS sp_card,
            COALESCE(sp.credit_amt, 0) AS sp_credit,
            COALESCE(sp.other_amt, 0) AS sp_other
       FROM ops.sales_master sm
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS split_rows,
                SUM(s.bill_amount) FILTER (WHERE ${SPLIT_MODE} = 'CASH') AS cash_amt,
                SUM(s.bill_amount) FILTER (WHERE ${SPLIT_MODE} IN ('CARD', 'CREDITCARD', 'CC')) AS card_amt,
                SUM(s.bill_amount) FILTER (WHERE ${SPLIT_MODE} = 'CREDIT') AS credit_amt,
                SUM(s.bill_amount) FILTER (WHERE ${SPLIT_MODE} NOT IN ('CASH', 'CARD', 'CREDITCARD', 'CC', 'CREDIT')) AS other_amt
           FROM ops.sales_payment_split s
          WHERE s.company_id = sm.company_id AND s.sales_id = sm.sales_id
            AND COALESCE(s.is_cancelled, FALSE) = FALSE
       ) sp ON TRUE
      WHERE sm.company_id = $1
        AND sm.bill_date >= $2::date
        AND sm.bill_date <  ($3::date + interval '1 day')
        AND ${VALID_SALE_BILL}
        ${parts.length ? `AND ${parts.join(' AND ')}` : ''}
   ),
   paid AS (
     SELECT b.*,
            CASE WHEN b.split_rows > 0 THEN b.sp_cash
                 WHEN b.mode = 'CASH' THEN b.amount
                 WHEN b.mode = 'MULTI' THEN b.m_cash ELSE 0 END AS cash_amt,
            CASE WHEN b.split_rows > 0 THEN b.sp_card
                 WHEN b.mode = 'CARD' THEN b.amount
                 WHEN b.mode = 'MULTI' THEN b.m_card ELSE 0 END AS card_amt,
            CASE WHEN b.split_rows > 0 THEN b.sp_credit
                 WHEN b.mode = 'CREDIT' THEN b.amount
                 WHEN b.mode = 'MULTI' THEN b.m_credit ELSE 0 END AS credit_amt,
            CASE WHEN b.split_rows > 0 THEN b.sp_other
                 WHEN b.mode = 'OTHER' THEN b.amount
                 WHEN b.mode = 'MULTI' THEN GREATEST(b.amount - b.m_cash - b.m_card - b.m_credit, 0)
                 ELSE 0 END AS other_amt
       FROM bills b
   )`;
}

// Station name lookup (station_master rows may be missing for back-office bills).
const STATION_NAME_JOIN = (alias) => `LEFT JOIN LATERAL (
         SELECT st.station_name FROM core.station_master st
          WHERE st.company_id = ${alias}.company_id AND st.station_id = ${alias}.station_id
          LIMIT 1
       ) stn ON TRUE`;

/* ───────────────────────── LOOKUPS ───────────────────────── */

async function safeRows(promise) {
  try {
    const { rows } = await promise;
    return rows;
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') return [];
    throw err;
  }
}

// Filter dropdown sources for the report pages.
export async function reportLookups(pool, companyId) {
  const [branches, branchesLegacy, stations, groups, subGroups, suppliers] = await Promise.all([
    safeRows(pool.query(
      `SELECT branch_id, branch_name, COALESCE(location_type, 'SHOP') AS location_type
         FROM core.branch_master WHERE company_id = $1 AND status = 'ACTIVE' ORDER BY branch_id`,
      [companyId],
    )),
    safeRows(pool.query(
      `SELECT branch_id, branch_name, 'SHOP' AS location_type
         FROM core.branch_master WHERE company_id = $1 AND status = 'ACTIVE' ORDER BY branch_id`,
      [companyId],
    )),
    safeRows(pool.query(
      `SELECT station_id, branch_id, station_name, station_type
         FROM core.station_master
        WHERE company_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE
          AND station_type <> 'BACKOFFICE'
        ORDER BY branch_id, station_id`,
      [companyId],
    )),
    safeRows(pool.query(
      `SELECT DISTINCT ON (group_id) group_id, group_description
         FROM biz.group_master WHERE company_id = $1
        ORDER BY group_id, id`,
      [companyId],
    )),
    safeRows(pool.query(
      `SELECT DISTINCT ON (sub_group_id) sub_group_id, group_id, sub_group_description
         FROM biz.sub_group_master WHERE company_id = $1
        ORDER BY sub_group_id, id`,
      [companyId],
    )),
    safeRows(pool.query(
      `SELECT supplier_id, supplier_name
         FROM biz.supplier_master
        WHERE company_id = $1 AND COALESCE(record_status, 'ACTIVE') = 'ACTIVE'
        ORDER BY supplier_name LIMIT 5000`,
      [companyId],
    )),
  ]);
  return {
    branches: branches.length ? branches : branchesLegacy,
    stations, groups, subGroups, suppliers,
  };
}

/* ───────────────────────── SALES ───────────────────────── */

// Daily Sales Summary — one row per bill.
export async function dailySales(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT sm.sales_id,
            COALESCE(sm.invoice_no, sm.bill_no::text, sm.sales_id::text) AS invoice_no,
            sm.bill_no,
            sm.bill_date,
            COALESCE(cm.customer_name, 'CASH CUSTOMER') AS customer,
            COALESCE(sm.payment_mode, 'CASH') AS payment_mode,
            COALESCE(sm.subtotal_amount, 0) AS subtotal_amount,
            COALESCE(sm.tax_1_amount,0)+COALESCE(sm.tax_2_amount,0)+COALESCE(sm.tax_3_amount,0) AS tax_amount,
            COALESCE(sm.discount_amount, 0) AS discount_amount,
            COALESCE(sm.amount, 0) AS amount,
            COALESCE(sm.post_status, 'DRAFT') AS post_status
       FROM ops.sales_master sm
       LEFT JOIN biz.customer_master cm
         ON cm.company_id = sm.company_id AND cm.customer_id = sm.customer_id
      WHERE sm.company_id = $1
        AND ($2::integer IS NULL OR sm.branch_id = $2::integer)
        AND UPPER(COALESCE(sm.record_status, 'ACTIVE')) <> 'CANCELLED'
        AND UPPER(COALESCE(TRIM(sm.transaction_type), '')) NOT IN ('RETURN', 'SALES RETURN')
        AND sm.bill_date >= $3::date
        AND sm.bill_date <  ($4::date + interval '1 day')
      ORDER BY sm.bill_date ASC, sm.sales_id ASC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

// Customer-Wise Sales — grouped per customer.
export async function customerWiseSales(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT COALESCE(cm.customer_name, 'CASH CUSTOMER') AS customer,
            COUNT(*)::int AS bills,
            COALESCE(SUM(sm.subtotal_amount),0) AS sub,
            COALESCE(SUM(sm.discount_amount),0) AS disc,
            COALESCE(SUM(COALESCE(sm.tax_1_amount,0)+COALESCE(sm.tax_2_amount,0)+COALESCE(sm.tax_3_amount,0)),0) AS tax,
            COALESCE(SUM(sm.amount),0) AS net
       FROM ops.sales_master sm
       LEFT JOIN biz.customer_master cm
         ON cm.company_id = sm.company_id AND cm.customer_id = sm.customer_id
      WHERE sm.company_id = $1 AND sm.branch_id = $2
        AND COALESCE(sm.record_status,'ACTIVE') = 'ACTIVE'
        AND sm.bill_date >= $3::date
        AND sm.bill_date <  ($4::date + interval '1 day')
      GROUP BY COALESCE(cm.customer_name, 'CASH CUSTOMER')
      ORDER BY net DESC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

// Product-Wise Sales — grouped per product (sales_child).
export async function productWiseSales(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT pm.product_code AS code,
            COALESCE(pm.barcode, '') AS barcode,
            COALESCE(pm.product_name, sc.short_description) AS product,
            COALESCE(g.group_description, '') AS grp,
            COALESCE(SUM(sc.qty),0) AS qty,
            CASE WHEN COALESCE(SUM(sc.qty),0) > 0
                 THEN COALESCE(SUM(sc.line_total),0) / SUM(sc.qty)
                 ELSE 0 END AS rate,
            COALESCE(SUM(sc.subtotal_amount),0) AS sub,
            COALESCE(SUM(sc.discount_amount),0) AS disc,
            COALESCE(SUM(sc.line_total),0) AS net
       FROM ops.sales_child sc
       JOIN ops.sales_master sm
         ON sm.company_id = sc.company_id AND sm.sales_id = sc.sales_id
       LEFT JOIN core.product_master pm
         ON pm.company_id = sc.company_id AND pm.product_id = sc.product_id
       LEFT JOIN biz.group_master g
         ON g.company_id = pm.company_id AND g.group_id = pm.group_id
      WHERE sc.company_id = $1 AND sm.branch_id = $2
        AND COALESCE(sm.record_status,'ACTIVE') = 'ACTIVE'
        AND sm.bill_date >= $3::date
        AND sm.bill_date <  ($4::date + interval '1 day')
      GROUP BY pm.product_code, COALESCE(pm.barcode, ''), COALESCE(pm.product_name, sc.short_description), COALESCE(g.group_description,'')
      ORDER BY net DESC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

// Sales By Agent — grouped per staff (salesman).
export async function salesByAgent(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT COALESCE(st.staff_name, 'UNASSIGNED') AS agent,
            COUNT(*)::int AS bills,
            COUNT(DISTINCT sm.customer_id)::int AS customers,
            COALESCE(SUM(sm.subtotal_amount),0) AS sub,
            COALESCE(SUM(sm.discount_amount),0) AS disc,
            COALESCE(SUM(sm.amount),0) AS net
       FROM ops.sales_master sm
       LEFT JOIN core.staff_master st
         ON st.company_id = sm.company_id AND st.staff_id = sm.staff_id
      WHERE sm.company_id = $1 AND sm.branch_id = $2
        AND COALESCE(sm.record_status,'ACTIVE') = 'ACTIVE'
        AND sm.bill_date >= $3::date
        AND sm.bill_date <  ($4::date + interval '1 day')
      GROUP BY COALESCE(st.staff_name, 'UNASSIGNED')
      ORDER BY net DESC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

// Sales Return — bills flagged as return (negative amount or post_status RETURN).
export async function salesReturn(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT sm.bill_no AS ret_no,
            sm.bill_date,
            COALESCE(sm.remarks, '') AS orig_bill,
            COALESCE(cm.customer_name, 'CASH CUSTOMER') AS customer,
            COALESCE(sm.remarks, '') AS reason,
            ABS(sm.amount) AS amount,
            CASE WHEN sm.post_status = 'POSTED' THEN 'Approved' ELSE 'Pending' END AS status
       FROM ops.sales_master sm
       LEFT JOIN biz.customer_master cm
         ON cm.company_id = sm.company_id AND cm.customer_id = sm.customer_id
      WHERE sm.company_id = $1 AND sm.branch_id = $2
        AND COALESCE(sm.record_status,'ACTIVE') = 'ACTIVE'
        AND sm.amount < 0
        AND sm.bill_date >= $3::date
        AND sm.bill_date <  ($4::date + interval '1 day')
      ORDER BY sm.bill_date ASC, sm.sales_id ASC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

// Sales Summary — one row per bill (sales AND returns) with payment split.
// f: { branchId (null = all), stationId, paymentMode }.
export async function salesSummary(pool, companyId, dateFrom, dateTo, f = {}) {
  const params = [companyId, dateFrom, dateTo];
  const cte = salesBillsCte(f, params);
  const { rows } = await pool.query(
    `WITH ${cte}
     SELECT p.sales_id, p.bill_no, p.invoice_no, p.bill_date, p.branch_id, p.station_id, p.counter_no,
            p.tx, p.mode, p.amount, p.subtotal_amount, p.discount_amount, p.tax_amount,
            p.cash_amt, p.card_amt, p.credit_amt, p.other_amt,
            COALESCE(cm.customer_name, 'CASH CUSTOMER') AS customer,
            COALESCE(bm.branch_name, '') AS branch_name,
            COALESCE(stn.station_name, '') AS station_name
       FROM paid p
       LEFT JOIN biz.customer_master cm
         ON cm.company_id = p.company_id AND cm.customer_id = p.customer_id
       LEFT JOIN core.branch_master bm
         ON bm.company_id = p.company_id AND bm.branch_id = p.branch_id
       ${STATION_NAME_JOIN('p')}
      ORDER BY p.bill_date ASC, p.sales_id ASC
      LIMIT 50000`,
    params,
  );
  return rows;
}

// Sales by POS / Shop — one row per branch × station: bills, qty, gross, returns, net, tender split.
export async function salesByPos(pool, companyId, dateFrom, dateTo, f = {}) {
  const params = [companyId, dateFrom, dateTo];
  const cte = salesBillsCte(f, params);
  const { rows } = await pool.query(
    `WITH ${cte},
     bill_qty AS (
       SELECT sc.sales_id, SUM(ABS(sc.qty)) AS qty
         FROM ops.sales_child sc
         JOIN bills b ON b.company_id = sc.company_id AND b.sales_id = sc.sales_id
        WHERE UPPER(COALESCE(sc.record_status, 'ACTIVE')) NOT IN ('CANCELLED', 'DELETED')
        GROUP BY sc.sales_id
     ),
     agg AS (
       SELECT p.company_id, p.branch_id, p.station_id,
              COUNT(*) FILTER (WHERE p.tx = 'SALE')::int AS bills,
              COUNT(*) FILTER (WHERE p.tx = 'RETURN')::int AS return_bills,
              COALESCE(SUM(q.qty) FILTER (WHERE p.tx = 'SALE'), 0) AS sale_qty,
              COALESCE(SUM(q.qty) FILTER (WHERE p.tx = 'RETURN'), 0) AS return_qty,
              COALESCE(SUM(p.amount) FILTER (WHERE p.tx = 'SALE'), 0) AS gross,
              COALESCE(SUM(p.amount) FILTER (WHERE p.tx = 'RETURN'), 0) AS returns,
              COALESCE(SUM(CASE WHEN p.tx = 'RETURN' THEN -p.discount_amount ELSE p.discount_amount END), 0) AS discount,
              COALESCE(SUM(CASE WHEN p.tx = 'RETURN' THEN -p.tax_amount ELSE p.tax_amount END), 0) AS tax,
              COALESCE(SUM(CASE WHEN p.tx = 'RETURN' THEN -p.cash_amt ELSE p.cash_amt END), 0) AS cash,
              COALESCE(SUM(CASE WHEN p.tx = 'RETURN' THEN -p.card_amt ELSE p.card_amt END), 0) AS card,
              COALESCE(SUM(CASE WHEN p.tx = 'RETURN' THEN -p.credit_amt ELSE p.credit_amt END), 0) AS credit,
              COALESCE(SUM(CASE WHEN p.tx = 'RETURN' THEN -p.other_amt ELSE p.other_amt END), 0) AS other
         FROM paid p
         LEFT JOIN bill_qty q ON q.sales_id = p.sales_id
        GROUP BY p.company_id, p.branch_id, p.station_id
     )
     SELECT a.*,
            COALESCE(bm.branch_name, 'Branch ' || a.branch_id::text) AS branch_name,
            COALESCE(stn.station_name, CASE WHEN a.station_id IS NULL THEN 'Back Office' ELSE 'Station ' || a.station_id::text END) AS station_name
       FROM agg a
       LEFT JOIN core.branch_master bm
         ON bm.company_id = a.company_id AND bm.branch_id = a.branch_id
       ${STATION_NAME_JOIN('a')}
      ORDER BY a.branch_id ASC, a.station_id ASC NULLS FIRST`,
    params,
  );
  return rows;
}

/**
 * Sales analysis by product / category (group) / sub-category, net of returns.
 * f: { branchId, stationId, groupId, subGroupId, product, groupBy, sortBy ('amount'|'qty'), limit }.
 */
export async function salesAnalysis(pool, companyId, dateFrom, dateTo, f = {}) {
  const params = [companyId, dateFrom, dateTo];
  const billWhere = [];
  if (f.branchId != null) { params.push(f.branchId); billWhere.push(`sm.branch_id = $${params.length}`); }
  if (f.stationId != null) { params.push(f.stationId); billWhere.push(`sm.station_id = $${params.length}`); }
  const lineFilter = productFilterSql(f, params, 'pm', 'COALESCE(pm.group_id, sc.group_id)');

  const keys = {
    product: {
      select: `l.product_id AS key_id,
               MAX(l.product_code) AS code, MAX(l.barcode) AS barcode, MAX(l.product_name) AS name,
               MAX(g.group_description) AS grp, MAX(s.sub_group_description) AS sub_grp,
               1 AS products`,
      group: 'l.product_id',
    },
    category: {
      select: `l.group_id AS key_id, '' AS code, '' AS barcode,
               COALESCE(MAX(g.group_description), 'UNCATEGORISED') AS name,
               COALESCE(MAX(g.group_description), 'UNCATEGORISED') AS grp, '' AS sub_grp,
               COUNT(DISTINCT l.product_id)::int AS products`,
      group: 'l.group_id',
    },
    subcategory: {
      select: `l.subgroup_id AS key_id, '' AS code, '' AS barcode,
               COALESCE(MAX(s.sub_group_description), 'NO SUB-CATEGORY') AS name,
               COALESCE(MAX(g.group_description), '') AS grp,
               COALESCE(MAX(s.sub_group_description), 'NO SUB-CATEGORY') AS sub_grp,
               COUNT(DISTINCT l.product_id)::int AS products`,
      group: 'l.subgroup_id',
    },
  }[f.groupBy] || null;
  if (!keys) throw Object.assign(new Error('groupBy must be product, category or subcategory'), { status: 400 });

  let limitSql = '';
  if (f.limit != null) { params.push(f.limit); limitSql = `LIMIT $${params.length}`; }
  const orderSql = f.sortBy === 'qty' ? 'net_qty DESC, net_amount DESC' : 'net_amount DESC, net_qty DESC';

  const { rows } = await pool.query(
    `WITH bills AS (
       SELECT sm.company_id, sm.sales_id,
              CASE WHEN ${SALE_RETURN_TX} THEN -1 ELSE 1 END AS sign
         FROM ops.sales_master sm
        WHERE sm.company_id = $1
          AND sm.bill_date >= $2::date
          AND sm.bill_date <  ($3::date + interval '1 day')
          AND ${VALID_SALE_BILL}
          ${billWhere.length ? `AND ${billWhere.join(' AND ')}` : ''}
     ),
     grp AS (
       SELECT DISTINCT ON (group_id) group_id, group_description
         FROM biz.group_master WHERE company_id = $1 ORDER BY group_id, id
     ),
     sgrp AS (
       SELECT DISTINCT ON (sub_group_id) sub_group_id, sub_group_description
         FROM biz.sub_group_master WHERE company_id = $1 ORDER BY sub_group_id, id
     ),
     lines AS (
       SELECT b.sign, sc.product_id,
              COALESCE(pm.group_id, sc.group_id) AS group_id,
              pm.subgroup_id,
              COALESCE(pm.product_code, sc.product_code, '') AS product_code,
              COALESCE(pm.barcode, '') AS barcode,
              COALESCE(pm.product_name, sc.short_description, '') AS product_name,
              ABS(sc.qty) AS qty,
              ABS(sc.line_total) AS amount
         FROM ops.sales_child sc
         JOIN bills b ON b.company_id = sc.company_id AND b.sales_id = sc.sales_id
         LEFT JOIN core.product_master pm
           ON pm.company_id = sc.company_id AND pm.product_id = sc.product_id
        WHERE sc.company_id = $1
          AND UPPER(COALESCE(sc.record_status, 'ACTIVE')) NOT IN ('CANCELLED', 'DELETED')${lineFilter}
     )
     SELECT ${keys.select},
            COALESCE(SUM(l.qty) FILTER (WHERE l.sign = 1), 0) AS sale_qty,
            COALESCE(SUM(l.qty) FILTER (WHERE l.sign = -1), 0) AS return_qty,
            COALESCE(SUM(l.sign * l.qty), 0) AS net_qty,
            COALESCE(SUM(l.amount) FILTER (WHERE l.sign = 1), 0) AS sale_amount,
            COALESCE(SUM(l.amount) FILTER (WHERE l.sign = -1), 0) AS return_amount,
            COALESCE(SUM(l.sign * l.amount), 0) AS net_amount
       FROM lines l
       LEFT JOIN grp g ON g.group_id = l.group_id
       LEFT JOIN sgrp s ON s.sub_group_id = l.subgroup_id
      GROUP BY ${keys.group}
      ORDER BY ${orderSql}
      ${limitSql}`,
    params,
  );
  return rows;
}

/* ──────────────────────── PURCHASE ──────────────────────── */

// Purchase Summary — one row per purchase bill.
// branchId null = all branches. filters: { supplierId, groupId, subGroupId, product }.
// When a category / product filter is set, only bills with a matching line are
// returned and the amounts are the matching lines' totals (detail-level join).
export async function purchaseSummary(pool, companyId, branchId, dateFrom, dateTo, filters = {}) {
  const params = [companyId, dateFrom, dateTo];
  const where = [];
  if (branchId != null) { params.push(branchId); where.push(`p.branch_id = $${params.length}`); }
  if (filters.supplierId != null) { params.push(filters.supplierId); where.push(`p.supplier_id = $${params.length}`); }
  const detail = productFilterSql(filters, params, 'pm');
  const hasDetail = detail !== '';
  const { rows } = await pool.query(
    `SELECT p.purchase_id,
            p.purchase_no AS bill_no,
            p.purchase_date,
            p.branch_id,
            COALESCE(bm.branch_name, '') AS branch_name,
            COALESCE(p.supplier_invoice_no, '') AS supplier_invoice_no,
            COALESCE(sp.supplier_name, 'UNKNOWN') AS supplier,
            COALESCE(d.items, 0) AS items,
            COALESCE(d.qty, 0) AS qty,
            ${hasDetail ? 'COALESCE(d.sub,0)' : 'COALESCE(p.subtotal_amount,0)'} AS sub,
            ${hasDetail ? 'COALESCE(d.tax,0)' : 'COALESCE(p.input_tax_1_amount,0)+COALESCE(p.input_tax_2_amount,0)+COALESCE(p.input_tax_3_amount,0)'} AS tax,
            ${hasDetail ? 'COALESCE(d.disc,0)' : 'COALESCE(p.discount_amount,0)'} AS disc,
            ${hasDetail ? 'COALESCE(d.net,0)' : 'COALESCE(p.invoice_amount,0)'} AS net
       FROM ops.purchase_master p
       LEFT JOIN biz.supplier_master sp
         ON sp.company_id = p.company_id AND sp.supplier_id = p.supplier_id
       LEFT JOIN core.branch_master bm
         ON bm.company_id = p.company_id AND bm.branch_id = p.branch_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS items,
                SUM(pc.qty) AS qty,
                SUM(pc.subtotal_amount) AS sub,
                SUM(COALESCE(pc.input_tax_1_amount,0)+COALESCE(pc.input_tax_2_amount,0)+COALESCE(pc.input_tax_3_amount,0)) AS tax,
                SUM(pc.discount_amount) AS disc,
                SUM(pc.line_amount) AS net
           FROM ops.purchase_child pc
           LEFT JOIN core.product_master pm
             ON pm.company_id = pc.company_id AND pm.product_id = pc.product_id
          WHERE pc.company_id = p.company_id AND pc.purchase_id = p.purchase_id
            AND COALESCE(pc.record_status,'ACTIVE') = 'ACTIVE'${detail}
       ) d ON TRUE
      WHERE p.company_id = $1
        AND COALESCE(p.record_status,'ACTIVE') = 'ACTIVE'
        AND UPPER(COALESCE(p.post_status,'')) <> 'CANCELLED'
        AND UPPER(COALESCE(p.transaction_type,'')) <> 'RETURN'
        AND p.purchase_date >= $2::date
        AND p.purchase_date <  ($3::date + interval '1 day')
        ${where.length ? `AND ${where.join(' AND ')}` : ''}
        ${hasDetail ? 'AND COALESCE(d.items,0) > 0' : ''}
      ORDER BY p.purchase_date ASC, p.purchase_id ASC`,
    params,
  );
  return rows;
}

// Supplier-Wise Purchase — grouped per supplier.
export async function supplierWisePurchase(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT COALESCE(sp.supplier_name, 'UNKNOWN') AS supplier,
            COUNT(*)::int AS bills,
            COALESCE(SUM((SELECT COUNT(*) FROM ops.purchase_child pc
              WHERE pc.company_id = p.company_id AND pc.purchase_id = p.purchase_id)),0)::int AS items,
            COALESCE(SUM(p.subtotal_amount),0) AS sub,
            COALESCE(SUM(COALESCE(p.input_tax_1_amount,0)+COALESCE(p.input_tax_2_amount,0)+COALESCE(p.input_tax_3_amount,0)),0) AS tax,
            COALESCE(SUM(p.discount_amount),0) AS disc,
            COALESCE(SUM(p.invoice_amount),0) AS net
       FROM ops.purchase_master p
       LEFT JOIN biz.supplier_master sp
         ON sp.company_id = p.company_id AND sp.supplier_id = p.supplier_id
      WHERE p.company_id = $1 AND p.branch_id = $2
        AND COALESCE(p.record_status,'ACTIVE') = 'ACTIVE'
        AND UPPER(COALESCE(p.post_status,'')) <> 'CANCELLED'
        AND p.purchase_date >= $3::date
        AND p.purchase_date <  ($4::date + interval '1 day')
      GROUP BY COALESCE(sp.supplier_name, 'UNKNOWN')
      ORDER BY net DESC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

// Purchase By Product — grouped per product from purchase_child.
export async function purchaseByProduct(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT pm.product_code AS code,
            COALESCE(pm.barcode, '') AS barcode,
            COALESCE(pm.product_name, pc.own_ref_no, 'UNKNOWN') AS product,
            COALESCE(g.group_description, '') AS grp,
            COALESCE(SUM(pc.qty),0) AS qty,
            CASE WHEN COALESCE(SUM(pc.qty),0) > 0
                 THEN COALESCE(SUM(pc.line_amount),0) / SUM(pc.qty)
                 ELSE 0 END AS rate,
            COALESCE(SUM(pc.subtotal_amount),0) AS sub,
            COALESCE(SUM(pc.discount_amount),0) AS disc,
            COALESCE(SUM(pc.line_amount),0) AS net
       FROM ops.purchase_child pc
       JOIN ops.purchase_master p
         ON p.company_id = pc.company_id AND p.purchase_id = pc.purchase_id
       LEFT JOIN core.product_master pm
         ON pm.company_id = pc.company_id AND pm.product_id = pc.product_id
       LEFT JOIN biz.group_master g
         ON g.company_id = pm.company_id AND g.group_id = pm.group_id
      WHERE pc.company_id = $1 AND p.branch_id = $2
        AND COALESCE(p.record_status,'ACTIVE') = 'ACTIVE'
        AND UPPER(COALESCE(p.post_status,'')) <> 'CANCELLED'
        AND (p.transaction_type IS NULL OR p.transaction_type != 'RETURN')
        AND p.purchase_date >= $3::date
        AND p.purchase_date <  ($4::date + interval '1 day')
      GROUP BY pm.product_code, COALESCE(pm.barcode, ''), COALESCE(pm.product_name, pc.own_ref_no, 'UNKNOWN'), COALESCE(g.group_description,'')
      ORDER BY net DESC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

// Purchase Return — supplier returns (transaction_type = 'RETURN').
export async function purchaseReturn(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT COALESCE(p.return_no, p.purchase_no) AS bill_no,
            p.purchase_date,
            COALESCE(sp.supplier_name, 'UNKNOWN') AS supplier,
            (SELECT COUNT(*)::int FROM ops.purchase_child pc
              WHERE pc.company_id = p.company_id AND pc.purchase_id = p.purchase_id) AS items,
            COALESCE(p.subtotal_amount,0) AS sub,
            COALESCE(p.input_tax_1_amount,0)+COALESCE(p.input_tax_2_amount,0)+COALESCE(p.input_tax_3_amount,0) AS tax,
            COALESCE(p.discount_amount,0) AS disc,
            ABS(COALESCE(p.invoice_amount,0)) AS net
       FROM ops.purchase_master p
       LEFT JOIN biz.supplier_master sp
         ON sp.company_id = p.company_id AND sp.supplier_id = p.supplier_id
      WHERE p.company_id = $1 AND p.branch_id = $2
        AND p.transaction_type = 'RETURN'
        AND COALESCE(p.record_status,'ACTIVE') = 'ACTIVE'
        AND UPPER(COALESCE(p.post_status,'')) <> 'CANCELLED'
        AND p.purchase_date >= $3::date
        AND p.purchase_date <  ($4::date + interval '1 day')
      ORDER BY p.purchase_date ASC, p.purchase_id ASC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

// Outstanding LPO — open / partial LPOs not yet closed or received.
export async function outstandingLPO(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT lm.lpo_no,
            lm.lpo_date,
            COALESCE(sp.supplier_name, lm.supplier_display_name, 'UNKNOWN') AS supplier,
            lm.status,
            (SELECT COUNT(*)::int FROM ops.lpo_child lc
              WHERE lc.company_id = lm.company_id AND lc.lpo_master_id = lm.lpo_master_id
                AND (lc.record_status IS NULL OR lc.record_status = 'ACTIVE')) AS items,
            COALESCE(lm.sub_total,0) AS sub,
            COALESCE(lm.discount_amount,0) AS disc,
            COALESCE(lm.lpo_amount,0) AS net
       FROM ops.lpo_master lm
       LEFT JOIN biz.supplier_master sp
         ON sp.company_id = lm.company_id AND sp.supplier_id = lm.supplier_id
      WHERE lm.company_id = $1 AND lm.branch_id = $2
        AND (lm.record_status IS NULL OR lm.record_status = 'ACTIVE')
        AND lm.status NOT IN ('CLOSED', 'RECEIVED')
      ORDER BY lm.lpo_date DESC, lm.lpo_master_id DESC`,
    [companyId, branchId],
  );
  return rows;
}

/* ───────────────────────── STOCK ───────────────────────── */

// Stock Summary — on-hand + value per product × branch, with in/out within period.
// branchId null = every branch (one row per product × branch; the service pivots
// it into a matrix). filters: { supplierId (last supplier), groupId, subGroupId, product }.
export async function stockSummary(pool, companyId, branchId, dateFrom, dateTo, filters = {}) {
  const params = [companyId, dateFrom, dateTo];
  let branchSql = '';
  if (branchId != null) { params.push(branchId); branchSql = ` AND i.branch_id = $${params.length}`; }
  let supplierSql = '';
  if (filters.supplierId != null) { params.push(filters.supplierId); supplierSql = ` AND pm.last_supplier_id = $${params.length}`; }
  const productSql = productFilterSql(filters, params, 'pm');
  const { rows } = await pool.query(
    `WITH mv AS (
       SELECT ple.branch_id, ple.product_id,
              SUM(CASE WHEN ple.qty > 0 THEN ple.qty ELSE 0 END) AS in_qty,
              SUM(CASE WHEN ple.qty < 0 THEN -ple.qty ELSE 0 END) AS out_qty
         FROM ops.product_log_entry ple
        WHERE ple.company_id = $1
          AND ple.transaction_date >= $2::date
          AND ple.transaction_date < ($3::date + interval '1 day')
        GROUP BY ple.branch_id, ple.product_id
     ),
     grp AS (
       SELECT DISTINCT ON (group_id) group_id, group_description
         FROM biz.group_master WHERE company_id = $1 ORDER BY group_id, id
     ),
     sgrp AS (
       SELECT DISTINCT ON (sub_group_id) sub_group_id, sub_group_description
         FROM biz.sub_group_master WHERE company_id = $1 ORDER BY sub_group_id, id
     )
     SELECT i.branch_id,
            COALESCE(bm.branch_name, '') AS branch_name,
            pm.product_id,
            pm.product_code AS code,
            COALESCE(pm.barcode, '') AS barcode,
            pm.product_name AS product,
            COALESCE(g.group_description,'') AS grp,
            COALESCE(sg.sub_group_description,'') AS sub_grp,
            COALESCE(sp.supplier_name,'') AS supplier,
            COALESCE(i.qty_on_hand,0) AS close_qty,
            COALESCE(NULLIF(i.average_cost,0), i.last_purchase_cost, 0) AS cost_price,
            COALESCE(i.qty_on_hand,0) * COALESCE(NULLIF(i.average_cost,0), i.last_purchase_cost, 0) AS stock_value,
            COALESCE(mv.in_qty,0) AS in_qty,
            COALESCE(mv.out_qty,0) AS out_qty
       FROM core.product_inventory i
       JOIN core.product_master pm
         ON pm.company_id = i.company_id AND pm.product_id = i.product_id
       LEFT JOIN core.branch_master bm
         ON bm.company_id = i.company_id AND bm.branch_id = i.branch_id
       LEFT JOIN grp g ON g.group_id = pm.group_id
       LEFT JOIN sgrp sg ON sg.sub_group_id = pm.subgroup_id
       LEFT JOIN biz.supplier_master sp
         ON sp.company_id = pm.company_id AND sp.supplier_id = pm.last_supplier_id
       LEFT JOIN mv ON mv.branch_id = i.branch_id AND mv.product_id = i.product_id
      WHERE i.company_id = $1
        AND COALESCE(i.record_status,'ACTIVE') = 'ACTIVE'
        AND COALESCE(pm.record_status,'ACTIVE') = 'ACTIVE'
        AND UPPER(REPLACE(TRIM(COALESCE(pm.stock_type, '')), '-', ' ')) <> 'NON INVENTORY'
        ${branchSql}${supplierSql}${productSql}
      ORDER BY pm.product_name ASC, i.branch_id ASC
      LIMIT 50000`,
    params,
  );
  return rows;
}

// Stock Ledger — movement history. productId optional; when null, all products.
// branchId null = all branches. filters: { supplierId, groupId, subGroupId, product }.
export async function stockLedger(pool, companyId, branchId, productId, dateFrom, dateTo, filters = {}) {
  const params = [companyId, dateFrom, dateTo];
  let extra = '';
  if (branchId != null) { params.push(branchId); extra += ` AND ple.branch_id = $${params.length}`; }
  if (productId != null) { params.push(productId); extra += ` AND ple.product_id = $${params.length}`; }
  if (filters.supplierId != null) { params.push(filters.supplierId); extra += ` AND pm.last_supplier_id = $${params.length}`; }
  extra += productFilterSql(filters, params, 'pm');
  const { rows } = await pool.query(
    `SELECT ple.transaction_date AS date,
            ple.branch_id,
            COALESCE(bm.branch_name, '') AS branch_name,
            COALESCE(ple.transaction_id::text, '') AS voucher,
            COALESCE(ple.transaction_type, '') AS type,
            COALESCE(pm.product_code, '') AS code,
            COALESCE(pm.barcode, '') AS barcode,
            COALESCE(pm.product_name, '') AS ref,
            CASE WHEN ple.qty > 0 THEN ple.qty ELSE 0 END AS in_qty,
            CASE WHEN ple.qty < 0 THEN ABS(ple.qty) ELSE 0 END AS out_qty,
            ple.balance_qty AS balance
       FROM ops.product_log_entry ple
       LEFT JOIN core.product_master pm
         ON pm.company_id = ple.company_id AND pm.product_id = ple.product_id
       LEFT JOIN core.branch_master bm
         ON bm.company_id = ple.company_id AND bm.branch_id = ple.branch_id
      WHERE ple.company_id = $1
        AND ple.transaction_date >= $2::date
        AND ple.transaction_date < ($3::date + interval '1 day')${extra}
      ORDER BY ple.branch_id ASC, ple.product_log_id ASC
      LIMIT 50000`,
    params,
  );
  return rows;
}

// Reorder — products at/below reorder level.
export async function reorder(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT pm.product_code AS code,
            COALESCE(pm.barcode, '') AS barcode,
            pm.product_name AS product,
            COALESCE(g.group_description,'') AS grp,
            COALESCE(i.qty_on_hand,0) AS current_qty,
            COALESCE(i.reorder_level,0) AS reorder_point,
            COALESCE(i.reorder_qty,0) AS reorder_qty,
            COALESCE(sp.supplier_name,'') AS supplier
       FROM core.product_inventory i
       JOIN core.product_master pm
         ON pm.company_id = i.company_id AND pm.product_id = i.product_id
       LEFT JOIN biz.group_master g
         ON g.company_id = pm.company_id AND g.group_id = pm.group_id
       LEFT JOIN biz.supplier_master sp
         ON sp.company_id = pm.company_id AND sp.supplier_id = pm.last_supplier_id
      WHERE i.company_id = $1 AND i.branch_id = $2
        AND COALESCE(i.record_status,'ACTIVE') = 'ACTIVE'
        AND COALESCE(pm.record_status,'ACTIVE') = 'ACTIVE'
        AND COALESCE(i.reorder_level,0) > 0
        AND COALESCE(i.qty_on_hand,0) <= COALESCE(i.reorder_level,0)
      ORDER BY (COALESCE(i.qty_on_hand,0) - COALESCE(i.reorder_level,0)) ASC`,
    [companyId, branchId],
  );
  return rows;
}

// product_log_entry.transaction_type → reconciliation bucket.
const LOG_TYPE = `UPPER(REPLACE(REPLACE(TRIM(COALESCE(ple.transaction_type, '')), '-', '_'), ' ', '_'))`;
const LOG_BUCKET = `CASE
         WHEN ${LOG_TYPE} IN ('PURCHASE', 'GRN', 'PURCHASE_RETURN', 'PURCHASERETURN') THEN 'PURCHASE'
         WHEN ${LOG_TYPE} LIKE 'TRANSFER%' OR ${LOG_TYPE} LIKE 'TRF%'
           OR ${LOG_TYPE} IN ('TR', 'RECEIVE', 'RECEIPT', 'RC', 'STOCK_TRANSFER') THEN 'TRANSFER'
         WHEN ${LOG_TYPE} IN ('SALE', 'SALES', 'SALES_CANCEL', 'RECIPE') THEN 'SALE'
         WHEN ${LOG_TYPE} IN ('RETURN', 'SALES_RETURN', 'SALESRETURN') THEN 'RETURN'
         ELSE 'ADJUST' END`;

/**
 * Inventory reconciliation per product × branch:
 *   opening (log before dateFrom) + purchases + transfers in − transfers out
 *   − sales + returns ± adjustments  = computed closing at dateTo,
 * compared with qty_on_hand rolled back to dateTo (on-hand minus later movements).
 * variance ≠ 0 means qty_on_hand drifted from the movement ledger.
 */
export async function inventoryReconciliation(pool, companyId, branchId, dateFrom, dateTo, filters = {}) {
  const params = [companyId, dateFrom, dateTo];
  let invBranch = '';
  let logBranch = '';
  if (branchId != null) {
    params.push(branchId);
    invBranch = ` AND i.branch_id = $${params.length}`;
    logBranch = ` AND ple.branch_id = $${params.length}`;
  }
  const productSql = productFilterSql(filters, params, 'pm');
  const varianceSql = filters.onlyVariance
    ? `AND ROUND(COALESCE(inv.qty_on_hand, 0) - COALESCE(lg.total_qty, 0), 4) <> 0`
    : '';
  const { rows } = await pool.query(
    `WITH inv AS (
       SELECT i.branch_id, i.product_id, i.qty_on_hand,
              COALESCE(NULLIF(i.average_cost, 0), i.last_purchase_cost, 0) AS unit_cost
         FROM core.product_inventory i
        WHERE i.company_id = $1 AND COALESCE(i.record_status, 'ACTIVE') = 'ACTIVE'${invBranch}
     ),
     lg AS (
       SELECT x.branch_id, x.product_id,
              SUM(x.qty) FILTER (WHERE x.transaction_date < $2::date) AS opening,
              SUM(x.qty) FILTER (WHERE x.in_period AND x.bucket = 'PURCHASE') AS purchases,
              SUM(x.qty) FILTER (WHERE x.in_period AND x.bucket = 'TRANSFER' AND x.qty > 0) AS transfer_in,
              SUM(-x.qty) FILTER (WHERE x.in_period AND x.bucket = 'TRANSFER' AND x.qty < 0) AS transfer_out,
              SUM(-x.qty) FILTER (WHERE x.in_period AND x.bucket = 'SALE') AS sales,
              SUM(x.qty) FILTER (WHERE x.in_period AND x.bucket = 'RETURN') AS returns,
              SUM(x.qty) FILTER (WHERE x.in_period AND x.bucket = 'ADJUST') AS adjustments,
              SUM(x.qty) FILTER (WHERE x.transaction_date > $3::date) AS after_qty,
              SUM(x.qty) AS total_qty
         FROM (
           SELECT ple.branch_id, ple.product_id, ple.qty, ple.transaction_date,
                  (ple.transaction_date >= $2::date AND ple.transaction_date <= $3::date) AS in_period,
                  ${LOG_BUCKET} AS bucket
             FROM ops.product_log_entry ple
            WHERE ple.company_id = $1${logBranch}
         ) x
        GROUP BY x.branch_id, x.product_id
     )
     SELECT COALESCE(inv.branch_id, lg.branch_id) AS branch_id,
            COALESCE(bm.branch_name, '') AS branch_name,
            pm.product_id, pm.product_code AS code, COALESCE(pm.barcode, '') AS barcode,
            pm.product_name AS product,
            COALESCE(lg.opening, 0) AS opening,
            COALESCE(lg.purchases, 0) AS purchases,
            COALESCE(lg.transfer_in, 0) AS transfer_in,
            COALESCE(lg.transfer_out, 0) AS transfer_out,
            COALESCE(lg.sales, 0) AS sales,
            COALESCE(lg.returns, 0) AS returns,
            COALESCE(lg.adjustments, 0) AS adjustments,
            COALESCE(lg.after_qty, 0) AS after_qty,
            COALESCE(lg.total_qty, 0) AS ledger_qty,
            COALESCE(inv.qty_on_hand, 0) AS on_hand,
            COALESCE(inv.unit_cost, 0) AS unit_cost
       FROM inv
       FULL JOIN lg ON lg.branch_id = inv.branch_id AND lg.product_id = inv.product_id
       JOIN core.product_master pm
         ON pm.company_id = $1 AND pm.product_id = COALESCE(inv.product_id, lg.product_id)
       LEFT JOIN core.branch_master bm
         ON bm.company_id = $1 AND bm.branch_id = COALESCE(inv.branch_id, lg.branch_id)
      WHERE UPPER(REPLACE(TRIM(COALESCE(pm.stock_type, '')), '-', ' ')) <> 'NON INVENTORY'
        ${productSql} ${varianceSql}
      ORDER BY pm.product_name ASC, COALESCE(inv.branch_id, lg.branch_id) ASC
      LIMIT 50000`,
    params,
  );
  return rows;
}

// Stock value (on-hand × cost) per branch vs the inventory GL balance at dateTo.
// GL inventory = Stock-in-Hand group (03-03…) plus the branch's
// SalesCostInventoryCRLedgerName integration ledger.
export async function stockValueVsGl(pool, companyId, branchId, dateTo) {
  const params = [companyId, dateTo];
  let invBranch = '';
  let glBranch = '';
  if (branchId != null) {
    params.push(branchId);
    invBranch = ` AND i.branch_id = $${params.length}`;
    glBranch = ` AND vd.branch_id = $${params.length}`;
  }
  const { rows } = await pool.query(
    `WITH sv AS (
       SELECT i.branch_id,
              SUM(COALESCE(i.qty_on_hand, 0) * COALESCE(NULLIF(i.average_cost, 0), i.last_purchase_cost, 0)) AS stock_value,
              SUM(COALESCE(i.qty_on_hand, 0)) AS stock_qty
         FROM core.product_inventory i
        WHERE i.company_id = $1 AND COALESCE(i.record_status, 'ACTIVE') = 'ACTIVE'${invBranch}
        GROUP BY i.branch_id
     ),
     inv_acc AS (
       SELECT ah.account_id
         FROM accounts.account_head_master ah
        WHERE ah.company_id = $1
          AND (ah.account_no = '03-03' OR ah.account_no LIKE '03-03-%'
               OR ah.account_id IN (
                 SELECT ap.account_id FROM accounts.accounts_parameter ap
                  WHERE ap.company_id = $1 AND ap.parameter_name = 'SalesCostInventoryCRLedgerName'
                    AND ap.account_id IS NOT NULL))
     ),
     gl AS (
       SELECT vd.branch_id, SUM(vd.debit_amount - vd.credit_amount) AS gl_balance
         FROM accounts.voucher_detail vd
         JOIN accounts.voucher_master vm
           ON vm.company_id = vd.company_id AND vm.branch_id = vd.branch_id
          AND vm.voucher_master_id = vd.voucher_master_id
        WHERE vd.company_id = $1
          AND vd.account_id IN (SELECT account_id FROM inv_acc)
          AND vd.record_status = 'ACTIVE' AND vm.record_status = 'ACTIVE'
          AND COALESCE(vm.post_status, '') NOT IN ('CANCELLED', 'DELETED')
          AND vm.voucher_date < ($2::date + interval '1 day')${glBranch}
        GROUP BY vd.branch_id
     )
     SELECT COALESCE(sv.branch_id, gl.branch_id) AS branch_id,
            COALESCE(bm.branch_name, '') AS branch_name,
            COALESCE(sv.stock_qty, 0) AS stock_qty,
            COALESCE(sv.stock_value, 0) AS stock_value,
            COALESCE(gl.gl_balance, 0) AS gl_balance
       FROM sv
       FULL JOIN gl ON gl.branch_id = sv.branch_id
       LEFT JOIN core.branch_master bm
         ON bm.company_id = $1 AND bm.branch_id = COALESCE(sv.branch_id, gl.branch_id)
      ORDER BY 1`,
    params,
  );
  return rows;
}

/* ──────────────────────── ACCOUNTS ──────────────────────── */

// Cash & Bank Movement — voucher detail lines hitting cash/bank ledgers.
export async function cashBankMovement(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT vm.voucher_date AS date,
            COALESCE(vm.auto_voucher_no::text, '') AS voucher,
            COALESCE(vt.voucher_name, '') AS type,
            ah.account_head AS account,
            COALESCE(vd.narration, '') AS narration,
            COALESCE(vd.debit_amount,0) AS debit,
            COALESCE(vd.credit_amount,0) AS credit
       FROM accounts.voucher_detail vd
       JOIN accounts.voucher_master vm
         ON vm.company_id = vd.company_id AND vm.branch_id = vd.branch_id
        AND vm.voucher_master_id = vd.voucher_master_id
       JOIN accounts.account_head_master ah
         ON ah.company_id = vd.company_id AND ah.account_id = vd.account_id
       LEFT JOIN accounts.voucher_type_master vt
         ON vt.company_id = vm.company_id AND vt.voucher_type_id = vm.voucher_type_id
      WHERE vd.company_id = $1 AND vd.branch_id = $2
        AND COALESCE(vd.record_status,'ACTIVE') = 'ACTIVE'
        AND COALESCE(vm.record_status,'ACTIVE') = 'ACTIVE'
        AND (ah.account_head ILIKE '%CASH%' OR ah.account_head ILIKE '%BANK%')
        AND vm.voucher_date >= $3::date
        AND vm.voucher_date < ($4::date + interval '1 day')
      ORDER BY vm.voucher_date ASC, vd.voucher_detail_id ASC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

/**
 * Sales ↔ accounting voucher reconciliation, one row per bill.
 * Linked vouchers: voucher_master.voucher_posted_id = sales_id on the bill's branch with a
 * sales-posting remark — 'SVT:' / 'SRT:' (back office), 'Credit Sale' (counter / salon POS),
 * 'RCV:' (back-office receipt against the bill).
 * Expected sales voucher: back-office bills post the full amount; POS bills only post the
 * credit portion (cash / card are settled through counter close, not per-bill vouchers).
 */
export async function salesVoucherReconciliation(pool, companyId, dateFrom, dateTo, f = {}) {
  const params = [companyId, dateFrom, dateTo];
  const cte = salesBillsCte(f, params);
  const { rows } = await pool.query(
    `WITH ${cte}
     SELECT p.sales_id, p.bill_no, p.invoice_no, p.bill_date, p.branch_id, p.station_id,
            p.tx, p.mode, p.amount, p.cash_amt, p.card_amt, p.credit_amt, p.other_amt,
            COALESCE(p.entry_source, '') AS entry_source,
            CASE WHEN UPPER(COALESCE(p.entry_source, '')) IN ('COUNTER-POS', 'SALON-POS', 'RESTAURANT-POS')
                 THEN p.credit_amt ELSE p.amount END AS expected_voucher,
            COALESCE(v.sales_vouchers, 0) AS sales_vouchers,
            COALESCE(v.posted_amount, 0) AS posted_voucher,
            COALESCE(v.receipt_amount, 0) AS receipt_voucher,
            COALESCE(v.pending_vouchers, 0) AS pending_vouchers,
            COALESCE(bm.branch_name, '') AS branch_name,
            COALESCE(stn.station_name, '') AS station_name
       FROM paid p
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE vm.remarks NOT ILIKE 'RCV:%')::int AS sales_vouchers,
                SUM(vm.voucher_amount) FILTER (WHERE vm.remarks NOT ILIKE 'RCV:%') AS posted_amount,
                SUM(vm.voucher_amount) FILTER (WHERE vm.remarks ILIKE 'RCV:%') AS receipt_amount,
                COUNT(*) FILTER (WHERE UPPER(COALESCE(vm.post_status, '')) <> 'POSTED')::int AS pending_vouchers
           FROM accounts.voucher_master vm
          WHERE vm.company_id = p.company_id
            AND vm.branch_id = p.branch_id
            AND vm.voucher_posted_id = p.sales_id
            AND vm.record_status = 'ACTIVE'
            AND COALESCE(vm.post_status, '') NOT IN ('CANCELLED', 'DELETED')
            AND UPPER(COALESCE(vm.creation_mode, '')) IN ('INVENTORYACCOUNTS', 'COUNTER-POS', 'SALON-POS')
            AND (vm.remarks ILIKE 'SVT:%' OR vm.remarks ILIKE 'SRT:%'
                 OR vm.remarks ILIKE 'RCV:%' OR vm.remarks ILIKE 'Credit Sale%')
       ) v ON TRUE
       LEFT JOIN core.branch_master bm
         ON bm.company_id = p.company_id AND bm.branch_id = p.branch_id
       ${STATION_NAME_JOIN('p')}
      ORDER BY p.bill_date ASC, p.sales_id ASC
      LIMIT 50000`,
    params,
  );
  return rows;
}

/**
 * Counter close (Z) check: totals recorded on the close vs the bills linked to it
 * (sales_master.counter_close_status = counter_close.id), and collected vs expected cash.
 */
export async function counterCloseReconciliation(pool, companyId, dateFrom, dateTo, f = {}) {
  const params = [companyId, dateFrom, dateTo];
  const where = [];
  if (f.branchId != null) { params.push(f.branchId); where.push(`cc.branch_id = $${params.length}`); }
  if (f.stationId != null) { params.push(f.stationId); where.push(`cc.station_id = $${params.length}`); }
  const { rows } = await pool.query(
    `WITH closes AS (
       SELECT cc.*
         FROM ops.counter_close cc
        WHERE cc.company_id = $1
          AND cc.report_type = 'Z'
          AND cc.close_date >= $2::date
          AND cc.close_date <  ($3::date + interval '1 day')
          ${where.length ? `AND ${where.join(' AND ')}` : ''}
     ),
     linked AS (
       SELECT c.id AS close_id,
              COUNT(*) FILTER (WHERE NOT ${SALE_RETURN_TX})::int AS bills,
              SUM(CASE
                    WHEN COALESCE(sp.split_rows, 0) > 0 THEN sp.cash_amt
                    WHEN ${BILL_MODE} = 'CASH' THEN ABS(sm.amount)
                    WHEN ${BILL_MODE} = 'MULTI' THEN ABS(COALESCE(sm.cash_amount, 0))
                    ELSE 0 END * CASE WHEN ${SALE_RETURN_TX} THEN -1 ELSE 1 END) AS cash,
              SUM(CASE
                    WHEN COALESCE(sp.split_rows, 0) > 0 THEN sp.card_amt
                    WHEN ${BILL_MODE} = 'CARD' THEN ABS(sm.amount)
                    WHEN ${BILL_MODE} = 'MULTI' THEN ABS(COALESCE(sm.credit_card_amount, 0))
                    ELSE 0 END * CASE WHEN ${SALE_RETURN_TX} THEN -1 ELSE 1 END) AS card,
              SUM(CASE
                    WHEN COALESCE(sp.split_rows, 0) > 0 THEN sp.credit_amt
                    WHEN ${BILL_MODE} = 'CREDIT' THEN ABS(sm.amount)
                    WHEN ${BILL_MODE} = 'MULTI' THEN ABS(COALESCE(sm.credit_amount, 0))
                    ELSE 0 END * CASE WHEN ${SALE_RETURN_TX} THEN -1 ELSE 1 END) AS credit
         FROM closes c
         JOIN ops.sales_master sm
           ON sm.company_id = c.company_id
          AND TRIM(COALESCE(sm.counter_close_status, '')) = c.id::text
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS split_rows,
                  COALESCE(SUM(s.bill_amount) FILTER (WHERE ${SPLIT_MODE} = 'CASH'), 0) AS cash_amt,
                  COALESCE(SUM(s.bill_amount) FILTER (WHERE ${SPLIT_MODE} IN ('CARD', 'CREDITCARD', 'CC', 'ONLINE')), 0) AS card_amt,
                  COALESCE(SUM(s.bill_amount) FILTER (WHERE ${SPLIT_MODE} = 'CREDIT'), 0) AS credit_amt
             FROM ops.sales_payment_split s
            WHERE s.company_id = sm.company_id AND s.sales_id = sm.sales_id
              AND COALESCE(s.is_cancelled, FALSE) = FALSE
         ) sp ON TRUE
        WHERE ${VALID_SALE_BILL}
        GROUP BY c.id
     )
     SELECT c.id, COALESCE(c.close_no, c.id::text) AS close_no, c.close_date,
            c.branch_id, c.station_id, c.counter_no,
            COALESCE(bm.branch_name, '') AS branch_name,
            COALESCE(stn.station_name, '') AS station_name,
            c.bill_count, COALESCE(l.bills, 0) AS linked_bills,
            c.total_cash, COALESCE(l.cash, 0) AS linked_cash,
            c.total_card, COALESCE(l.card, 0) AS linked_card,
            c.total_credit, COALESCE(l.credit, 0) AS linked_credit,
            c.cash_in, c.cash_out, c.cash_to_be_collected, c.collected_cash, c.cash_difference
       FROM closes c
       LEFT JOIN linked l ON l.close_id = c.id
       LEFT JOIN core.branch_master bm
         ON bm.company_id = c.company_id AND bm.branch_id = c.branch_id
       ${STATION_NAME_JOIN('c')}
      ORDER BY c.close_date ASC, c.id ASC`,
    params,
  );
  return rows;
}

/* ──────────────────────── HR ──────────────────────── */

export async function attendanceReport(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT ad.work_date,
            em.employee_code,
            em.employee_name,
            COALESCE(em.department, '') AS department,
            COALESCE(ad.first_in::text, '') AS first_in,
            COALESCE(ad.last_out::text, '') AS last_out,
            CASE WHEN ad.first_in IS NOT NULL AND ad.last_out >= ad.first_in
              THEN ROUND((EXTRACT(EPOCH FROM (ad.last_out - ad.first_in)) / 3600)::numeric, 2)
              ELSE NULL END AS hours,
            COALESCE(ad.ot_hours, 0) AS ot_hours,
            COALESCE(ad.attendance_status, '') AS status
       FROM hr.attendance_daily ad
       JOIN hr.employee_master em
         ON em.company_id = ad.company_id AND em.branch_id = ad.branch_id AND em.employee_id = ad.employee_id
      WHERE ad.company_id = $1 AND ad.branch_id = $2
        AND ad.work_date >= $3::date
        AND ad.work_date < ($4::date + interval '1 day')
      ORDER BY ad.work_date DESC, em.employee_name ASC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

export async function leaveReport(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT em.employee_code,
            em.employee_name,
            COALESCE(em.department, '') AS department,
            COALESCE(ltm.leave_name, '') AS leave_type,
            lr.from_date,
            lr.to_date,
            COALESCE(lr.total_days, 0) AS total_days,
            COALESCE(lr.request_status, '') AS status
       FROM hr.leave_request lr
       JOIN hr.employee_master em
         ON em.company_id = lr.company_id AND em.branch_id = lr.branch_id AND em.employee_id = lr.employee_id
       LEFT JOIN hr.leave_type_master ltm
         ON ltm.company_id = lr.company_id AND ltm.branch_id = lr.branch_id AND ltm.leave_type_id = lr.leave_type_id
      WHERE lr.company_id = $1 AND lr.branch_id = $2
        AND lr.from_date >= $3::date
        AND lr.from_date < ($4::date + interval '1 day')
      ORDER BY lr.from_date DESC, em.employee_name ASC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}
