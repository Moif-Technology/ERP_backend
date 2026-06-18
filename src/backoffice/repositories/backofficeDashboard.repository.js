async function one(pool, sql, params) {
  const { rows } = await pool.query(sql, params);
  return rows[0] ?? {};
}

export async function getSummary(pool, { companyId, branchId }) {
  const branchFilter = Number.isFinite(branchId) && branchId > 0;
  const branchSql = branchFilter ? 'AND branch_id = $2' : '';
  const params = branchFilter ? [companyId, branchId] : [companyId];

  const [
    products,
    customers,
    staff,
    devices,
    todaySales,
    pendingCounter,
    lastClose,
    lowStock,
  ] = await Promise.all([
    one(pool, `
      SELECT
        COUNT(*)::int AS total_products,
        COUNT(*) FILTER (WHERE NULLIF(TRIM(COALESCE(barcode, '')), '') IS NULL)::int AS missing_barcodes
      FROM core.product_master
      WHERE company_id = $1
        AND COALESCE(record_status, 'ACTIVE') = 'ACTIVE'
        AND COALESCE(product_status, 'ACTIVE') = 'ACTIVE'
    `, [companyId]),
    one(pool, `
      SELECT COUNT(*)::int AS total_customers
      FROM biz.customer_master
      WHERE company_id = $1
        AND COALESCE(status, 'ACTIVE') = 'ACTIVE'
    `, [companyId]),
    one(pool, `
      SELECT
        COUNT(*)::int AS total_staff,
        COUNT(*) FILTER (WHERE staff_pin IS NOT NULL)::int AS staff_with_pin
      FROM core.staff_master
      WHERE company_id = $1
        AND record_status = 'ACTIVE'
    `, [companyId]),
    one(pool, `
      SELECT
        COUNT(*)::int AS total_devices,
        COUNT(*) FILTER (WHERE record_status = 'ACTIVE')::int AS active_devices
      FROM core.pos_device_enrollment
      WHERE company_id = $1
    `, [companyId]),
    one(pool, `
      SELECT
        COUNT(*)::int AS bill_count,
        COALESCE(SUM(amount), 0)::numeric AS net_sales,
        COALESCE(SUM(CASE WHEN payment_mode = 'CASH' THEN amount ELSE 0 END), 0)::numeric AS cash_sales,
        COALESCE(SUM(CASE WHEN payment_mode = 'CARD' THEN amount ELSE 0 END), 0)::numeric AS card_sales
      FROM ops.sales_master
      WHERE company_id = $1
        ${branchSql}
        AND post_status = 'POSTED'
        AND COALESCE(hold_status, '') NOT IN ('HOLD', 'CANCELLED')
        AND bill_date::date = CURRENT_DATE
    `, params),
    one(pool, `
      SELECT
        COUNT(*)::int AS pending_bills,
        COALESCE(SUM(amount), 0)::numeric AS pending_amount
      FROM ops.sales_master
      WHERE company_id = $1
        ${branchSql}
        AND post_status = 'POSTED'
        AND COALESCE(hold_status, '') NOT IN ('HOLD', 'CANCELLED')
        AND COALESCE(counter_close_status, 'PENDING') = 'PENDING'
    `, params),
    one(pool, `
      SELECT close_date, close_no, counter_no, collected_cash, cash_difference
      FROM ops.counter_close
      WHERE company_id = $1
        ${branchSql}
        AND report_type = 'Z'
      ORDER BY close_date DESC
      LIMIT 1
    `, params),
    one(pool, `
      SELECT COUNT(*)::int AS low_stock_items
      FROM core.product_inventory inv
      JOIN core.product_master p
        ON p.company_id = inv.company_id
       AND p.product_id = inv.product_id
      WHERE inv.company_id = $1
        ${branchSql.replace('branch_id', 'inv.branch_id')}
        AND COALESCE(inv.record_status, 'ACTIVE') = 'ACTIVE'
        AND COALESCE(p.record_status, 'ACTIVE') = 'ACTIVE'
        AND inv.reorder_level > 0
        AND inv.qty_on_hand <= inv.reorder_level
    `, params),
  ]);

  return {
    products,
    customers,
    staff,
    devices,
    todaySales,
    pendingCounter,
    lastClose,
    lowStock,
  };
}

export async function getRecentSales(pool, { companyId, branchId, limit = 5 }) {
  const branchFilter = Number.isFinite(branchId) && branchId > 0;
  const params = branchFilter ? [companyId, branchId, limit] : [companyId, limit];
  const branchSql = branchFilter ? 'AND sm.branch_id = $2' : '';
  const limitParam = branchFilter ? '$3' : '$2';

  const { rows } = await pool.query(`
    SELECT
      sm.sales_id,
      sm.bill_no,
      sm.bill_date,
      sm.counter_no,
      sm.payment_mode,
      sm.amount,
      sm.staff_id,
      s.staff_name
    FROM ops.sales_master sm
    LEFT JOIN core.staff_master s
      ON s.company_id = sm.company_id
     AND s.staff_id = sm.staff_id
    WHERE sm.company_id = $1
      ${branchSql}
      AND sm.post_status = 'POSTED'
      AND COALESCE(sm.hold_status, '') NOT IN ('HOLD', 'CANCELLED')
    ORDER BY sm.bill_date DESC, sm.sales_id DESC
    LIMIT ${limitParam}
  `, params);
  return rows;
}

export async function getMonthlySalesTrend(pool, { companyId, branchId, months = 6 }) {
  const branchFilter = Number.isFinite(branchId) && branchId > 0;
  const params = branchFilter ? [companyId, branchId, months] : [companyId, months];
  const branchSql = branchFilter ? 'AND branch_id = $2' : '';
  const monthsParam = branchFilter ? '$3' : '$2';

  const { rows } = await pool.query(`
    WITH month_series AS (
      SELECT generate_series(
        date_trunc('month', CURRENT_DATE) - (($${branchFilter ? '3' : '2'}::int - 1) * interval '1 month'),
        date_trunc('month', CURRENT_DATE),
        interval '1 month'
      ) AS month_start
    )
    SELECT
      to_char(ms.month_start, 'Mon') AS label,
      COALESCE(COUNT(sm.sales_id), 0)::int AS bills,
      COALESCE(SUM(sm.amount), 0)::numeric AS sales
    FROM month_series ms
    LEFT JOIN ops.sales_master sm
      ON sm.company_id = $1
     ${branchSql}
     AND sm.post_status = 'POSTED'
     AND COALESCE(sm.hold_status, '') NOT IN ('HOLD', 'CANCELLED')
     AND date_trunc('month', sm.bill_date::date) = ms.month_start
    GROUP BY ms.month_start
    ORDER BY ms.month_start
  `, params);
  return rows;
}

export async function getWeeklySalesTrend(pool, { companyId, branchId }) {
  const branchFilter = Number.isFinite(branchId) && branchId > 0;
  const params = branchFilter ? [companyId, branchId] : [companyId];
  const branchSql = branchFilter ? 'AND sm.branch_id = $2' : '';

  const { rows } = await pool.query(`
    WITH day_series AS (
      SELECT generate_series(
        CURRENT_DATE - interval '6 day',
        CURRENT_DATE,
        interval '1 day'
      )::date AS day
    )
    SELECT
      to_char(ds.day, 'Dy') AS label,
      ds.day,
      COALESCE(COUNT(sm.sales_id), 0)::int AS bills,
      COALESCE(SUM(sm.amount), 0)::numeric AS sales
    FROM day_series ds
    LEFT JOIN ops.sales_master sm
      ON sm.company_id = $1
     ${branchSql}
     AND sm.post_status = 'POSTED'
     AND COALESCE(sm.hold_status, '') NOT IN ('HOLD', 'CANCELLED')
     AND sm.bill_date::date = ds.day
    GROUP BY ds.day
    ORDER BY ds.day
  `, params);
  return rows;
}

export async function getTopProducts(pool, { companyId, branchId, limit = 5 }) {
  const branchFilter = Number.isFinite(branchId) && branchId > 0;
  const params = branchFilter ? [companyId, branchId, limit] : [companyId, limit];
  const branchSql = branchFilter ? 'AND sm.branch_id = $2' : '';
  const limitParam = branchFilter ? '$3' : '$2';

  const { rows } = await pool.query(`
    SELECT
      COALESCE(sc.short_description, sc.product_code, 'Product') AS product,
      COALESCE(SUM(sc.qty), 0)::numeric AS qty,
      COALESCE(SUM(sc.line_total), 0)::numeric AS amount
    FROM ops.sales_child sc
    JOIN ops.sales_master sm
      ON sm.company_id = sc.company_id
     AND sm.sales_id = sc.sales_id
    WHERE sm.company_id = $1
      ${branchSql}
      AND sm.post_status = 'POSTED'
      AND COALESCE(sm.hold_status, '') NOT IN ('HOLD', 'CANCELLED')
      AND sm.bill_date::date >= CURRENT_DATE - INTERVAL '30 day'
    GROUP BY COALESCE(sc.short_description, sc.product_code, 'Product')
    ORDER BY amount DESC
    LIMIT ${limitParam}
  `, params);
  return rows;
}
