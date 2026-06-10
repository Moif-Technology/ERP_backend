/**
 * Counter-POS customer lookups — self-contained, no imports from shared repos.
 */

function mapCustomer(row) {
  return {
    customerId:    Number(row.customer_id),
    customerCode:  row.customer_code,
    customerName:  row.customer_name,
    mobileNo:      row.mobile_no    ?? null,
    telephone:     row.telephone    ?? null,
    paymentMode:   row.payment_mode ?? 'CASH',
    creditLimit:   row.credit_limit   != null ? Number(row.credit_limit)   : 0,
    creditBalance: row.credit_balance != null ? Number(row.credit_balance) : 0,
    loyaltyStatus: row.loyalty_status ?? null,
    customerType:  row.customer_type  ?? null,
  };
}

export async function searchCustomers(pool, companyId, search, limit = 40) {
  const cap = Math.min(Math.max(Number(limit) || 40, 1), 200);
  const q = String(search || '').trim();
  const params = [companyId];
  let searchSql = '';

  if (q) {
    params.push(`%${q}%`);
    searchSql = `AND (
      customer_code  ILIKE $2
      OR customer_name ILIKE $2
      OR COALESCE(mobile_no, '')  ILIKE $2
      OR COALESCE(telephone, '')  ILIKE $2
      OR COALESCE(email, '')      ILIKE $2
    )`;
  }

  params.push(cap);
  const { rows } = await pool.query(
    `SELECT customer_id, customer_code, customer_name, mobile_no, telephone,
            payment_mode, credit_balance, credit_limit, loyalty_status, customer_type
     FROM biz.customer_master
     WHERE company_id = $1
       AND (status IS NULL OR status = 'ACTIVE')
       ${searchSql}
     ORDER BY customer_name ASC
     LIMIT $${params.length}`,
    params,
  );

  return rows.map(mapCustomer);
}
