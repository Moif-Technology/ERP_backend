/**
 * Staff Repository — Database queries for staff performance analytics.
 * Read-only queries.
 */

export async function getStaffPerformance(client, { companyId, branchId, fromDate, toDate }) {
  // ops.sales_master.staff_id / salesman_id is written with TWO conventions:
  // newer POS writes core.staff_master.id (global PK), older rows write the
  // per-company staff_master.staff_id. Match either or the older bills go
  // unattributed and the leaderboard undercounts vs /sales. Safe because the
  // sales side is already scoped to this company_id + branch_id.
  // ponytail: accept-both join, drop the IN () once the legacy rows are normalised.
  const query = `
    SELECT
      s.staff_id,
      s.staff_name as name,
      COALESCE(SUM(sl.amount), 0) as total_revenue,
      COUNT(sl.sales_id) as transaction_count,
      COALESCE(SUM(tip.tip_amount), 0) as total_tips,
      CASE
        WHEN COUNT(sl.sales_id) > 0
        THEN ROUND(COALESCE(SUM(sl.amount), 0) / COUNT(sl.sales_id), 2)
        ELSE 0
      END as avg_transaction,
      CASE
        WHEN COUNT(sl.sales_id) >= 20 THEN 4.8
        WHEN COUNT(sl.sales_id) >= 15 THEN 4.5
        WHEN COUNT(sl.sales_id) >= 10 THEN 4.3
        ELSE 4.0
      END as performance_rating
    FROM
      core.staff_master s
      LEFT JOIN ops.sales_master sl
        ON COALESCE(sl.staff_id, sl.salesman_id) IN (s.id, s.staff_id)
        AND sl.company_id = $1
        AND sl.branch_id = $2
        AND sl.bill_date::DATE >= $3::DATE
        AND sl.bill_date::DATE <= $4::DATE
        AND COALESCE(sl.is_deleted, FALSE) = FALSE
        AND COALESCE(sl.record_status, 'ACTIVE') = 'ACTIVE'
      LEFT JOIN LATERAL (
        SELECT SUM(ps.tip_amount) as tip_amount
        FROM ops.sales_payment_split ps
        WHERE ps.company_id = sl.company_id
          AND ps.sales_id = sl.sales_id
          AND COALESCE(ps.is_deleted, FALSE) = FALSE
          AND COALESCE(ps.is_cancelled, FALSE) = FALSE
      ) tip ON TRUE
    WHERE
      s.company_id = $1
      AND s.branch_id = $2
      AND s.record_status = 'ACTIVE'
      AND COALESCE(s.is_deleted, FALSE) = FALSE
    GROUP BY
      s.staff_id, s.staff_name
    ORDER BY
      total_revenue DESC;
  `;

  const result = await client.query(query, [companyId, branchId, fromDate, toDate]);

  return result.rows.map((row) => ({
    staff_id: row.staff_id,
    name: row.name,
    total_revenue: Number(row.total_revenue),
    transaction_count: Number(row.transaction_count),
    total_tips: Number(row.total_tips),
    avg_transaction: Number(row.avg_transaction),
    performance_rating: Number(row.performance_rating),
  }));
}
