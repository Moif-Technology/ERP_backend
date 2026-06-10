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

  return {
    openJobs: Number(openJobs.rows[0].cnt),
    invoicedTodayCount: Number(invoicedToday.rows[0].cnt),
    invoicedTodayAmount: Number(invoicedToday.rows[0].amount),
    pendingPartsRequests: Number(pendingParts.rows[0].cnt),
    pendingEstimations: Number(pendingEstimations.rows[0].cnt),
    revenueThisMonth: Number(monthRevenue.rows[0].amount),
    activeTechniciansToday: Number(techUtil.rows[0].active_techs),
    totalHoursToday: Number(techUtil.rows[0].total_hours),
  };
}
