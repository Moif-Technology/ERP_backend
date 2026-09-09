/**
 * Customer Repository — Database queries for customer ledger and outstanding balances.
 * Read-only queries.
 */

export async function getCustomerLedger(client, { companyId, branchId }) {
  const query = `
    SELECT
      c.customer_id,
      c.customer_name as name,
      COALESCE(SUM(sl.amount), 0) as total_debit,
      COALESCE(SUM(COALESCE(sl.paid_amount, 0)), 0) as total_credit,
      COALESCE(SUM(COALESCE(sl.outstanding_balance, sl.credit_amount, 0)), 0) as balance,
      MAX(sl.bill_date) as last_transaction
    FROM
      biz.customer_master c
      LEFT JOIN ops.sales_master sl ON c.customer_id = sl.customer_id
        AND c.company_id = sl.company_id
        AND sl.company_id = $1
        AND sl.branch_id = $2
        AND COALESCE(sl.is_deleted, FALSE) = FALSE
    WHERE
      c.company_id = $1
      AND COALESCE(c.is_deleted, FALSE) = FALSE
      AND COALESCE(c.status, 'ACTIVE') = 'ACTIVE'
    GROUP BY
      c.customer_id, c.customer_name
    HAVING
      SUM(COALESCE(sl.outstanding_balance, sl.credit_amount, 0)) > 0
    ORDER BY
      balance DESC;
  `;

  const result = await client.query(query, [companyId, branchId]);

  return result.rows.map((row) => ({
    customer_id: row.customer_id,
    name: row.name,
    total_debit: Number(row.total_debit),
    total_credit: Number(row.total_credit),
    balance: Number(row.balance),
    last_transaction: row.last_transaction,
  }));
}

export async function getUnpaidBills(client, { companyId, branchId }) {
  const query = `
    SELECT
      sl.sales_id as bill_id,
      c.customer_name,
      COALESCE(sl.outstanding_balance, sl.credit_amount, sl.amount, 0) as amount,
      FLOOR(EXTRACT(DAY FROM NOW() - sl.bill_date))::INT as days_overdue,
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
      AND COALESCE(sl.outstanding_balance, sl.credit_amount, 0) > 0
    ORDER BY
      days_overdue DESC, sl.bill_date ASC
    LIMIT 100;
  `;

  const result = await client.query(query, [companyId, branchId]);

  return result.rows.map((row) => ({
    bill_id: row.bill_id,
    customer_name: row.customer_name || 'Walk-in',
    amount: Number(row.amount),
    days_overdue: Number(row.days_overdue),
    created_at: row.created_at,
  }));
}
