/**
 * Trial balance tree — chart accounts, movements, stock, voucher detail lines.
 */

export async function listChartAccounts(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT account_id,
            parent_acc_id,
            account_no,
            account_head,
            COALESCE(alias, account_head) AS alias,
            account_type,
            group_type,
            level_no,
            display_order,
            posting_allowed,
            COALESCE(opening_balance, 0)::numeric AS opening_balance
       FROM accounts.account_head_master
      WHERE company_id = $1
        AND (record_status IS NULL OR TRIM(UPPER(record_status)) = 'ACTIVE')
      ORDER BY COALESCE(display_order, 9999) ASC, account_no ASC, account_id ASC`,
    [companyId],
  );
  return rows;
}

export async function sumMovementsByAccount(pool, companyId, { branchId, dateFrom, dateTo } = {}) {
  const params = [companyId];
  let where = `vd.company_id = $1
    AND vd.record_status = 'ACTIVE'
    AND vm.record_status = 'ACTIVE'
    AND COALESCE(vm.post_status, '') NOT IN ('CANCELLED', 'DELETED')`;
  if (branchId) {
    params.push(branchId);
    where += ` AND vd.branch_id = $${params.length}`;
  }
  if (dateFrom) {
    params.push(dateFrom);
    where += ` AND vm.voucher_date >= $${params.length}::date`;
  }
  if (dateTo) {
    params.push(dateTo);
    where += ` AND vm.voucher_date < ($${params.length}::date + interval '1 day')`;
  }

  const { rows } = await pool.query(
    `SELECT vd.account_id,
            COALESCE(SUM(vd.debit_amount), 0)::numeric AS total_debit,
            COALESCE(SUM(vd.credit_amount), 0)::numeric AS total_credit
       FROM accounts.voucher_detail vd
       JOIN accounts.voucher_master vm
         ON vm.company_id = vd.company_id
        AND vm.branch_id = vd.branch_id
        AND vm.voucher_master_id = vd.voucher_master_id
      WHERE ${where}
      GROUP BY vd.account_id`,
    params,
  );
  return rows;
}

/** Current inventory value for branch (closing stock proxy). */
export async function sumStockValue(pool, companyId, branchId) {
  if (!branchId) return 0;
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(
              COALESCE(i.qty_on_hand, 0)
              * COALESCE(i.average_cost, i.last_purchase_cost, 0)
            ), 0)::numeric AS stock_value
       FROM core.product_inventory i
      WHERE i.company_id = $1
        AND i.branch_id = $2
        AND COALESCE(i.record_status, 'ACTIVE') = 'ACTIVE'`,
    [companyId, branchId],
  );
  return Number(rows[0]?.stock_value || 0);
}

/**
 * Voucher lines for trial-balance ledger drill-down (3rd tree level).
 */
export async function listLedgerVoucherLines(pool, companyId, { branchId, dateFrom, dateTo, accountIds } = {}) {
  const ids = (Array.isArray(accountIds) ? accountIds : [])
    .map(Number)
    .filter((id) => id > 0);
  if (!ids.length) return [];

  const params = [companyId, ids];
  let where = `vd.company_id = $1
    AND vd.account_id = ANY($2::int[])
    AND vd.record_status = 'ACTIVE'
    AND vm.record_status = 'ACTIVE'
    AND COALESCE(vm.post_status, '') NOT IN ('CANCELLED', 'DELETED')`;
  if (branchId) {
    params.push(branchId);
    where += ` AND vd.branch_id = $${params.length}`;
  }
  if (dateFrom) {
    params.push(dateFrom);
    where += ` AND vm.voucher_date >= $${params.length}::date`;
  }
  if (dateTo) {
    params.push(dateTo);
    where += ` AND vm.voucher_date < ($${params.length}::date + interval '1 day')`;
  }

  const { rows } = await pool.query(
    `SELECT vd.account_id,
            vd.debit_amount,
            vd.credit_amount,
            vm.voucher_date,
            vm.auto_voucher_no,
            vm.voucher_prefix,
            vm.voucher_master_id,
            (
              SELECT ah2.account_head
                FROM accounts.voucher_detail vd2
                JOIN accounts.account_head_master ah2
                  ON ah2.company_id = vd2.company_id
                 AND ah2.account_id = vd2.account_id
               WHERE vd2.company_id = vm.company_id
                 AND vd2.branch_id = vm.branch_id
                 AND vd2.voucher_master_id = vm.voucher_master_id
                 AND vd2.record_status = 'ACTIVE'
                 AND vd2.voucher_detail_id <> vd.voucher_detail_id
                 AND (
                   (COALESCE(vd.debit_amount, 0) > 0 AND COALESCE(vd2.credit_amount, 0) > 0)
                   OR (COALESCE(vd.credit_amount, 0) > 0 AND COALESCE(vd2.debit_amount, 0) > 0)
                 )
               ORDER BY vd2.voucher_detail_id
               LIMIT 1
            ) AS counter_head
       FROM accounts.voucher_detail vd
       JOIN accounts.voucher_master vm
         ON vm.company_id = vd.company_id
        AND vm.branch_id = vd.branch_id
        AND vm.voucher_master_id = vd.voucher_master_id
      WHERE ${where}
      ORDER BY vd.account_id ASC, vm.voucher_date ASC, vm.auto_voucher_no ASC, vd.voucher_detail_id ASC`,
    params,
  );
  return rows;
}
