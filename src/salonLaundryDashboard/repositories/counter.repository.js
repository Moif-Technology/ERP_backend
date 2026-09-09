/**
 * Counter Close Repository — Database queries for shift management.
 * Read-only queries from production database.
 */

export async function getDailySummary(client, { companyId, branchId, date }) {
  const query = `
    SELECT
      COALESCE(MIN(sl.sales_id), 0) as shift_id,
      COALESCE(MAX(sl.staff_id), MAX(sl.salesman_id)) as staff_id,
      COALESCE(MAX(s.staff_name), 'Counter') as staff_name,
      MIN(sl.bill_date) as start_time,
      NULL::timestamp as end_time,
      COALESCE(SUM(sl.amount), 0) as total_revenue,
      COUNT(DISTINCT sl.sales_id) as total_transactions,
      COALESCE(SUM(CASE WHEN UPPER(COALESCE(pm.pay_mode, sl.payment_mode, '')) = 'CASH'
        THEN COALESCE(pm.bill_amount, sl.cash_amount, 0) ELSE 0 END), 0) as cash_revenue,
      COALESCE(SUM(CASE WHEN UPPER(COALESCE(pm.pay_mode, sl.payment_mode, '')) IN ('CARD', 'CREDIT_CARD', 'CREDIT CARD')
        THEN COALESCE(pm.bill_amount, sl.credit_card_amount, 0) ELSE 0 END), 0) as card_revenue,
      COALESCE(SUM(CASE WHEN UPPER(COALESCE(pm.pay_mode, sl.payment_mode, '')) = 'CREDIT'
        THEN COALESCE(pm.bill_amount, sl.credit_amount, sl.outstanding_balance, 0) ELSE 0 END), 0) as credit_revenue,
      0 as expenses
    FROM
      ops.sales_master sl
      LEFT JOIN core.staff_master s
        ON s.company_id = sl.company_id
       AND s.id = COALESCE(sl.staff_id, sl.salesman_id)
      LEFT JOIN ops.sales_payment_split pm
        ON pm.company_id = sl.company_id
       AND pm.sales_id = sl.sales_id
       AND COALESCE(pm.is_deleted, FALSE) = FALSE
       AND COALESCE(pm.is_cancelled, FALSE) = FALSE
    WHERE
      sl.company_id = $1
      AND sl.branch_id = $2
      AND sl.bill_date::DATE = $3::DATE
      AND COALESCE(sl.is_deleted, FALSE) = FALSE
      AND COALESCE(sl.record_status, 'ACTIVE') = 'ACTIVE';
  `;

  const result = await client.query(query, [companyId, branchId, date]);
  if (result.rows.length === 0) {
    return {
      shift_id: `shift-${new Date().getTime()}`,
      staff_id: null,
      staff_name: 'No Active Shift',
      start_time: new Date(),
      end_time: null,
      total_revenue: 0,
      total_transactions: 0,
      cash_revenue: 0,
      card_revenue: 0,
      credit_revenue: 0,
      expenses: 0,
      expected_cash: 0,
    };
  }

  const row = result.rows[0];
  return {
    shift_id: `counter-${date}-${row.shift_id}`,
    staff_id: row.staff_id,
    staff_name: row.staff_name,
    start_time: row.start_time,
    end_time: row.end_time,
    total_revenue: Number(row.total_revenue),
    total_transactions: Number(row.total_transactions),
    cash_revenue: Number(row.cash_revenue),
    card_revenue: Number(row.card_revenue),
    credit_revenue: Number(row.credit_revenue),
    expenses: Number(row.expenses),
    expected_cash: Number(row.cash_revenue),
  };
}

export async function getPendingBills(client, { companyId, branchId }) {
  const query = `
    SELECT
      sl.sales_id as bill_id,
      c.customer_name,
      COALESCE(sl.outstanding_balance, sl.credit_amount, sl.amount, 0) as amount,
      sl.bill_date as created_at
    FROM
      ops.sales_master sl
      LEFT JOIN biz.customer_master c
        ON c.company_id = sl.company_id
       AND c.customer_id = sl.customer_id
    WHERE
      sl.company_id = $1
      AND sl.branch_id = $2
      AND COALESCE(sl.is_deleted, FALSE) = FALSE
      AND COALESCE(sl.record_status, 'ACTIVE') = 'ACTIVE'
      AND COALESCE(sl.outstanding_balance, sl.credit_amount, 0) > 0
    ORDER BY
      sl.bill_date DESC
    LIMIT 50;
  `;

  const result = await client.query(query, [companyId, branchId]);
  return result.rows.map((row) => ({
    bill_id: row.bill_id,
    customer_name: row.customer_name || 'Walk-in',
    amount: Number(row.amount),
    created_at: row.created_at,
  }));
}

export async function insertShiftClose(client, { shiftId, companyId, branchId, actualCash, notes }) {
  const query = `
    UPDATE ops.sales_master
    SET
      counter_close_status = 'CLOSED',
      modified_at = NOW(),
      modified_by = $2
    WHERE
      company_id = $3
      AND branch_id = $4
      AND bill_date::DATE = CURRENT_DATE
      AND COALESCE(is_deleted, FALSE) = FALSE
    RETURNING sales_id AS shift_id;
  `;

  const result = await client.query(query, [actualCash, notes || 'dashboard-close', companyId, branchId]);
  return result.rows[0] || { shift_id: shiftId };
}
