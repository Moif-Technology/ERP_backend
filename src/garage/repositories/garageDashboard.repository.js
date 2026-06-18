export async function getDashboardKpis(pool, companyId, branchId) {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + '-01';

  const [openJobs, invoicedToday, pendingParts, pendingEstimations, monthRevenue, techUtil] =
    await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS cnt FROM garage.job_card
         WHERE company_id=$1 AND branch_id=$2 AND status NOT IN ('CLOSED','CANCELLED')`,
        [companyId, branchId]
      ),
      pool.query(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount),0) AS amount
         FROM garage.invoice
         WHERE company_id=$1 AND branch_id=$2 AND invoice_date=$3 AND status='POSTED'`,
        [companyId, branchId, today]
      ),
      pool.query(
        `SELECT COUNT(*) AS cnt FROM garage.part_request
         WHERE company_id=$1 AND branch_id=$2 AND status IN ('PENDING','PARTIALLY_ISSUED')`,
        [companyId, branchId]
      ),
      pool.query(
        `SELECT COUNT(*) AS cnt FROM garage.estimation
         WHERE company_id=$1 AND branch_id=$2 AND estimation_status='PENDING'`,
        [companyId, branchId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(total_amount),0) AS amount
         FROM garage.invoice
         WHERE company_id=$1 AND branch_id=$2 AND invoice_date>=$3 AND status='POSTED'`,
        [companyId, branchId, monthStart]
      ),
      pool.query(
        `SELECT COUNT(DISTINCT technician_id) AS active_techs,
                COALESCE(SUM(actual_hours),0) AS total_hours
         FROM garage.job_code_punching
         WHERE company_id=$1 AND branch_id=$2 AND DATE(start_time)=$3 AND status='CLOSED'`,
        [companyId, branchId, today]
      ),
    ]);

  const [recentJobs, pendingRequests, upcomingDeliveries, weeklyTrend] = await Promise.all([
    pool.query(
      `SELECT jc_no, reg_no, COALESCE(customer_name, veh_owner_name) AS customer_name,
              service_advisor, status, booking_date
         FROM garage.job_card
        WHERE company_id=$1 AND branch_id=$2
        ORDER BY id DESC
        LIMIT 5`,
      [companyId, branchId]
    ),
    pool.query(
      `SELECT request_no, jc_no, requested_by, status, request_date
         FROM garage.part_request
        WHERE company_id=$1 AND branch_id=$2
          AND status IN ('PENDING','PARTIALLY_ISSUED')
          AND record_status='ACTIVE'
        ORDER BY id DESC
        LIMIT 5`,
      [companyId, branchId]
    ),
    pool.query(
      `SELECT jc_no, reg_no, COALESCE(customer_name, veh_owner_name) AS customer_name,
              promise_date, status
         FROM garage.job_card
        WHERE company_id=$1 AND branch_id=$2
          AND status NOT IN ('CLOSED','CANCELLED')
          AND promise_date IS NOT NULL
        ORDER BY promise_date ASC
        LIMIT 5`,
      [companyId, branchId]
    ),
    pool.query(
      `WITH day_series AS (
         SELECT generate_series(CURRENT_DATE - interval '6 day', CURRENT_DATE, interval '1 day')::date AS day
       )
       SELECT
         to_char(ds.day, 'Dy') AS label,
         COALESCE(COUNT(jc.id) FILTER (WHERE jc.booking_date = ds.day), 0)::int AS opened,
         COALESCE(COUNT(jc.id) FILTER (WHERE jc.status = 'CLOSED' AND jc.modified_at::date = ds.day), 0)::int AS completed
       FROM day_series ds
       LEFT JOIN garage.job_card jc
         ON jc.company_id=$1 AND jc.branch_id=$2
        AND (jc.booking_date = ds.day OR (jc.status = 'CLOSED' AND jc.modified_at::date = ds.day))
       GROUP BY ds.day
       ORDER BY ds.day`,
      [companyId, branchId]
    ),
  ]);

  return {
    openJobs: Number(openJobs.rows[0].cnt),
    invoicedTodayCount: Number(invoicedToday.rows[0].cnt),
    invoicedTodayAmount: Number(invoicedToday.rows[0].amount),
    pendingPartsRequests: Number(pendingParts.rows[0].cnt),
    pendingEstimations: Number(pendingEstimations.rows[0].cnt),
    revenueThisMonth: Number(monthRevenue.rows[0].amount),
    activeTechniciansToday: Number(techUtil.rows[0].active_techs),
    totalHoursToday: Number(techUtil.rows[0].total_hours),
    recentJobCards: recentJobs.rows.map((r) => ({
      jcNo: r.jc_no,
      regNo: r.reg_no,
      customerName: r.customer_name,
      serviceAdvisor: r.service_advisor,
      status: r.status,
      bookingDate: r.booking_date,
    })),
    pendingPartRequests: pendingRequests.rows.map((r) => ({
      requestNo: r.request_no,
      jcNo: r.jc_no,
      requestedBy: r.requested_by,
      status: r.status,
      requestDate: r.request_date,
    })),
    upcomingDeliveries: upcomingDeliveries.rows.map((r) => ({
      jcNo: r.jc_no,
      regNo: r.reg_no,
      customerName: r.customer_name,
      promiseDate: r.promise_date,
      status: r.status,
    })),
    weeklyJobTrend: weeklyTrend.rows.map((r) => ({
      label: r.label,
      opened: Number(r.opened),
      completed: Number(r.completed),
    })),
  };
}
