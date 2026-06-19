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
    address:       row.address      ?? null,
    taxRegNo:      row.customer_tax_reg_no ?? null,
    paymentMode:   row.payment_mode ?? 'CASH',
    creditLimit:   row.credit_limit   != null ? Number(row.credit_limit)   : 0,
    creditBalance: row.credit_balance != null ? Number(row.credit_balance) : 0,
    // Tally-style outstanding: SUM(debit_amount) − SUM(credit_amount) across active voucher_detail rows
    osBalance:     row.os_balance     != null ? Number(row.os_balance)     : 0,
    loyaltyStatus: row.loyalty_status ?? null,
    customerType:  row.customer_type  ?? null,
  };
}

/**
 * Search customers within a company.
 * Joins `accounts.voucher_detail` to compute Tally-style outstanding balance
 * (debit − credit) per customer. Falls back to `credit_balance` field if the
 * voucher tables are missing on legacy DBs.
 */
export async function searchCustomers(pool, companyId, search, limit = 40) {
  const cap = Math.min(Math.max(Number(limit) || 40, 1), 200);
  const q = String(search || '').trim();
  const params = [companyId];
  let searchSql = '';

  if (q) {
    params.push(`%${q}%`);
    searchSql = `AND (
      cm.customer_code  ILIKE $2
      OR cm.customer_name ILIKE $2
      OR COALESCE(cm.mobile_no, '')  ILIKE $2
      OR COALESCE(cm.telephone, '')  ILIKE $2
      OR COALESCE(cm.email, '')      ILIKE $2
    )`;
  }

  params.push(cap);
  const limitIdx = params.length;

  // Customer ↔ ledger mapping is account_head_master.account_no == customer_code
  // (one-to-one within a company). The LATERAL aggregates voucher_detail for
  // that ledger to give a Tally-style outstanding = SUM(debit) − SUM(credit).
  const sqlWithVouchers = `
    SELECT cm.customer_id, cm.customer_code, cm.customer_name, cm.mobile_no, cm.telephone,
           cm.address, cm.customer_tax_reg_no,
           cm.payment_mode, cm.credit_balance, cm.credit_limit, cm.loyalty_status, cm.customer_type,
           COALESCE(vd.os_balance, 0)::numeric AS os_balance
    FROM biz.customer_master cm
    LEFT JOIN accounts.account_head_master ah
      ON ah.company_id = cm.company_id
     AND ah.account_no = cm.customer_code
     AND (ah.record_status IS NULL OR TRIM(UPPER(ah.record_status)) = 'ACTIVE')
    LEFT JOIN LATERAL (
      SELECT (COALESCE(SUM(debit_amount), 0) - COALESCE(SUM(credit_amount), 0)) AS os_balance
      FROM accounts.voucher_detail
      WHERE company_id = cm.company_id
        AND account_id = ah.account_id
        AND (record_status IS NULL OR TRIM(UPPER(record_status)) = 'ACTIVE')
    ) vd ON ah.account_id IS NOT NULL
    WHERE cm.company_id = $1
      AND (cm.status IS NULL OR cm.status = 'ACTIVE')
      ${searchSql}
    ORDER BY cm.customer_name ASC
    LIMIT $${limitIdx}`;

  try {
    const { rows } = await pool.query(sqlWithVouchers, params);
    return rows.map(mapCustomer);
  } catch (e) {
    if (e.code !== '42P01' && e.code !== '42703') throw e;
    // voucher_detail missing on this DB — fall back to the static credit_balance column
    const sqlFallback = `
      SELECT cm.customer_id, cm.customer_code, cm.customer_name, cm.mobile_no, cm.telephone,
             cm.address, cm.customer_tax_reg_no,
             cm.payment_mode, cm.credit_balance, cm.credit_limit, cm.loyalty_status, cm.customer_type,
             COALESCE(cm.credit_balance, 0) AS os_balance
      FROM biz.customer_master cm
      WHERE cm.company_id = $1
        AND (cm.status IS NULL OR cm.status = 'ACTIVE')
        ${searchSql}
      ORDER BY cm.customer_name ASC
      LIMIT $${limitIdx}`;
    const { rows } = await pool.query(sqlFallback, params);
    return rows.map(mapCustomer);
  }
}

/**
 * Outstanding balance for a single customer (Tally-style: SUM(debit) − SUM(credit)).
 * Customer is linked to its ledger via account_head_master.account_no == customer_code.
 * Returns 0 when the customer has no ledger yet or the voucher tables are missing.
 */
export async function getCustomerOsBalance(db, companyId, customerId) {
  try {
    const { rows } = await db.query(
      `SELECT (COALESCE(SUM(vd.debit_amount), 0) - COALESCE(SUM(vd.credit_amount), 0))::numeric AS os
       FROM biz.customer_master cm
       JOIN accounts.account_head_master ah
         ON ah.company_id = cm.company_id
        AND ah.account_no = cm.customer_code
       LEFT JOIN accounts.voucher_detail vd
         ON vd.company_id = ah.company_id
        AND vd.account_id = ah.account_id
        AND (vd.record_status IS NULL OR TRIM(UPPER(vd.record_status)) = 'ACTIVE')
       WHERE cm.company_id = $1 AND cm.customer_id = $2`,
      [companyId, customerId],
    );
    return Number(rows[0]?.os || 0);
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return 0;
    throw e;
  }
}
