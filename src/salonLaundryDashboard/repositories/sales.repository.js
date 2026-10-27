/**
 * Sales Repository — Database queries for sales analytics.
 * Read-only queries.
 */

export async function getSalesSummary(client, { companyId, branchId, fromDate, toDate }) {
  const query = `
    SELECT
      COALESCE(SUM(sl.amount), 0) as total_revenue,
      COUNT(DISTINCT sl.sales_id) as transaction_count,
      COUNT(DISTINCT sl.customer_id) as unique_customers
    FROM
      ops.sales_master sl
    WHERE
      sl.company_id = $1
      AND sl.branch_id = $2
      AND sl.bill_date::DATE >= $3::DATE
      AND sl.bill_date::DATE <= $4::DATE
      AND COALESCE(sl.is_deleted, FALSE) = FALSE
      AND COALESCE(sl.record_status, 'ACTIVE') = 'ACTIVE';
  `;

  const result = await client.query(query, [companyId, branchId, fromDate, toDate]);
  const row = result.rows[0];

  return {
    total_revenue: Number(row.total_revenue),
    transaction_count: Number(row.transaction_count),
    unique_customers: Number(row.unique_customers),
  };
}

export async function getSalesByProduct(client, { companyId, branchId, fromDate, toDate }) {
  const query = `
    SELECT
      pm.product_name as product,
      COALESCE(SUM(sli.line_total), 0) as revenue,
      COALESCE(SUM(sli.qty), 0) as count
    FROM
      ops.sales_child sli
      JOIN ops.sales_master sl
        ON sli.company_id = sl.company_id
       AND sli.sales_id = sl.sales_id
      LEFT JOIN core.product_master pm
        ON pm.company_id = sli.company_id
       AND pm.product_id = sli.product_id
    WHERE
      sl.company_id = $1
      AND sl.branch_id = $2
      AND sl.bill_date::DATE >= $3::DATE
      AND sl.bill_date::DATE <= $4::DATE
      AND COALESCE(sl.is_deleted, FALSE) = FALSE
      AND COALESCE(sli.is_deleted, FALSE) = FALSE
      AND COALESCE(sl.record_status, 'ACTIVE') = 'ACTIVE'
    GROUP BY
      pm.product_name
    ORDER BY
      revenue DESC;
  `;

  const result = await client.query(query, [companyId, branchId, fromDate, toDate]);

  return result.rows.map((row) => ({
    product: row.product || 'Unknown',
    revenue: Number(row.revenue),
    count: Number(row.count),
  }));
}

export async function getSalesByPaymentMethod(client, { companyId, branchId, fromDate, toDate }) {
  const query = `
    SELECT
      pm.pay_mode as method,
      COALESCE(SUM(pm.bill_amount), 0) as amount
    FROM
      ops.sales_payment_split pm
      JOIN ops.sales_master sl
        ON pm.company_id = sl.company_id
       AND pm.sales_id = sl.sales_id
    WHERE
      sl.company_id = $1
      AND sl.branch_id = $2
      AND sl.bill_date::DATE >= $3::DATE
      AND sl.bill_date::DATE <= $4::DATE
      AND COALESCE(sl.is_deleted, FALSE) = FALSE
      AND COALESCE(pm.is_deleted, FALSE) = FALSE
      AND COALESCE(pm.is_cancelled, FALSE) = FALSE
    GROUP BY
      pm.pay_mode
    ORDER BY
      amount DESC;
  `;

  const result = await client.query(query, [companyId, branchId, fromDate, toDate]);

  return result.rows.map((row) => ({
    method: row.method || 'UNKNOWN',
    amount: Number(row.amount),
  }));
}
