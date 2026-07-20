export async function getDashboardStats(pool, companyId, branchId, staffId, date) {
  const { rows } = await pool.query(
    `WITH sales_stats AS (
       SELECT
         COUNT(*)::int                        AS invoice_count,
         COALESCE(SUM(amount), 0)::numeric    AS revenue
       FROM ops.sales_master
       WHERE company_id   = $1
         AND branch_id    = $2
         AND staff_id     = $3
         AND bill_date::date = $4::date
         AND entry_source = 'VAN'
         AND COALESCE(hold_status, '') NOT IN ('HOLD', 'CANCELLED')
     ),
     customer_count AS (
       SELECT COUNT(*)::int AS total
       FROM biz.customer_master
       WHERE company_id = $1
         AND COALESCE(status, 'ACTIVE') = 'ACTIVE'
     ),
     sku_count AS (
       SELECT COUNT(*)::int AS total
       FROM core.product_inventory
       WHERE company_id = $1
         AND branch_id  = $2
         AND COALESCE(record_status, 'ACTIVE') = 'ACTIVE'
         AND qty_on_hand > 0
     )
     SELECT
       s.invoice_count,
       s.revenue,
       c.total AS total_customers,
       k.total AS total_skus
     FROM sales_stats s, customer_count c, sku_count k`,
    [companyId, branchId, staffId, date],
  );
  return rows[0] ?? { invoice_count: 0, revenue: 0, total_customers: 0, total_skus: 0 };
}

export async function getVanDaySummary(pool, companyId, branchId, staffId, date) {
  const { rows } = await pool.query(
    `SELECT sm.sales_id,
            sm.bill_no,
            sm.bill_date,
            sm.payment_mode,
            sm.amount,
            sm.subtotal_amount,
            COALESCE(sm.tax_1_amount, 0) + COALESCE(sm.tax_2_amount, 0) + COALESCE(sm.tax_3_amount, 0) AS tax_amount,
            sm.discount_amount,
            sm.customer_id,
            cm.customer_name,
            cm.customer_code
     FROM ops.sales_master sm
     LEFT JOIN biz.customer_master cm
       ON cm.company_id = sm.company_id
      AND cm.customer_id = sm.customer_id
     WHERE sm.company_id = $1
       AND sm.branch_id  = $2
       AND sm.staff_id   = $3
       AND sm.bill_date::date = $4::date
     ORDER BY sm.sales_id DESC`,
    [companyId, branchId, staffId, date],
  );
  return rows;
}

export async function listVans(db, companyId) {
  const { rows } = await db.query(
    `SELECT van_id, van_code, van_name, plate_no, is_active, branch_id
     FROM ops.van_master
     WHERE company_id = $1
     ORDER BY van_id ASC`,
    [companyId],
  );
  return rows;
}

export async function listRoutes(db, companyId) {
  const { rows } = await db.query(
    `SELECT route_id, route_code, route_name, description, is_active, branch_id
     FROM ops.route_master
     WHERE company_id = $1
     ORDER BY route_id ASC`,
    [companyId],
  );
  return rows;
}

export async function getTodayAssignment(db, companyId, staffId, date) {
  const { rows } = await db.query(
    `SELECT a.id, a.van_id, a.route_id, a.assignment_date, a.opening_cash, a.status,
            v.van_code, v.van_name, v.plate_no,
            r.route_code, r.route_name
     FROM ops.van_day_assignment a
     LEFT JOIN ops.van_master  v ON v.company_id = a.company_id AND v.van_id   = a.van_id
     LEFT JOIN ops.route_master r ON r.company_id = a.company_id AND r.route_id = a.route_id
     WHERE a.company_id = $1
       AND a.staff_id   = $2
       AND a.assignment_date = $3::date
     LIMIT 1`,
    [companyId, staffId, date],
  );
  return rows[0] ?? null;
}

export async function insertDayAssignment(db, params) {
  const { companyId, branchId, staffId, vanId, routeId, assignmentDate, openingCash, actor } = params;
  const { rows } = await db.query(
    `INSERT INTO ops.van_day_assignment
       (company_id, branch_id, staff_id, van_id, route_id, assignment_date, opening_cash, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'OPEN', $8)
     ON CONFLICT (company_id, staff_id, assignment_date)
     DO UPDATE SET
       van_id       = EXCLUDED.van_id,
       route_id     = EXCLUDED.route_id,
       opening_cash = EXCLUDED.opening_cash,
       modified_at  = NOW(),
       modified_by  = $8
     RETURNING id, van_id, route_id, assignment_date, opening_cash, status`,
    [companyId, branchId, staffId, vanId, routeId ?? null, assignmentDate, openingCash ?? 0, actor],
  );
  return rows[0];
}
