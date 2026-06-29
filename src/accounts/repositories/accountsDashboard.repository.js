function branchFilter(branchId, alias = 'vm') {
  return Number.isFinite(Number(branchId)) && Number(branchId) > 0
    ? { sql: `AND ${alias}.branch_id = $2`, enabled: true }
    : { sql: '', enabled: false };
}

export async function getCashBankBalance(pool, { companyId, branchId, dateTo }) {
  const branch = branchFilter(branchId, 'vm');
  const params = branch.enabled ? [companyId, branchId, dateTo] : [companyId, dateTo];
  const dateParam = branch.enabled ? '$3' : '$2';
  const { rows } = await pool.query(`
    SELECT COALESCE(SUM(vd.debit_amount - vd.credit_amount), 0)::numeric AS balance
    FROM accounts.voucher_detail vd
    JOIN accounts.voucher_master vm
      ON vm.company_id = vd.company_id
     AND vm.branch_id = vd.branch_id
     AND vm.voucher_master_id = vd.voucher_master_id
    JOIN accounts.account_head_master ah
      ON ah.company_id = vd.company_id
     AND ah.account_id = vd.account_id
    WHERE vm.company_id = $1
      ${branch.sql}
      AND vm.record_status = 'ACTIVE'
      AND vd.record_status = 'ACTIVE'
      AND UPPER(COALESCE(vm.post_status, 'PENDING')) = 'POSTED'
      AND vm.voucher_date::date <= ${dateParam}::date
      AND (
        ah.account_no = '03-01'
        OR ah.account_no LIKE '03-01-%'
        OR ah.account_no = '03-02'
        OR ah.account_no LIKE '03-02-%'
      )
  `, params);
  return rows[0] || { balance: 0 };
}

export async function getVoucherTypeBreakdown(pool, { companyId, branchId, dateFrom, dateTo }) {
  const branch = branchFilter(branchId, 'vm');
  const params = branch.enabled
    ? [companyId, branchId, dateFrom, dateTo]
    : [companyId, dateFrom, dateTo];
  const fromParam = branch.enabled ? '$3' : '$2';
  const toParam = branch.enabled ? '$4' : '$3';
  const { rows } = await pool.query(`
    SELECT
      COALESCE(vt.voucher_type_code, 'OTHER') AS code,
      COALESCE(vt.voucher_name, 'Other Voucher') AS name,
      COUNT(*)::int AS count,
      COALESCE(SUM(vm.voucher_amount), 0)::numeric AS amount
    FROM accounts.voucher_master vm
    LEFT JOIN accounts.voucher_type_master vt
      ON vt.company_id = vm.company_id
     AND vt.voucher_type_id = vm.voucher_type_id
    WHERE vm.company_id = $1
      ${branch.sql}
      AND vm.record_status = 'ACTIVE'
      AND vm.voucher_date::date BETWEEN ${fromParam}::date AND ${toParam}::date
    GROUP BY COALESCE(vt.voucher_type_code, 'OTHER'), COALESCE(vt.voucher_name, 'Other Voucher')
    ORDER BY count DESC, name ASC
  `, params);
  return rows;
}

export async function getFinancialTrend(pool, { companyId, branchId, dateFrom, dateTo }) {
  const branch = branchFilter(branchId, 'vm');
  const params = branch.enabled
    ? [companyId, branchId, dateFrom, dateTo]
    : [companyId, dateFrom, dateTo];
  const fromParam = branch.enabled ? '$3' : '$2';
  const toParam = branch.enabled ? '$4' : '$3';
  const { rows } = await pool.query(`
    WITH bounds AS (
      SELECT ${fromParam}::date AS date_from, ${toParam}::date AS date_to
    ),
    grain AS (
      SELECT CASE WHEN date_to - date_from <= 45 THEN 'day' ELSE 'month' END AS value
      FROM bounds
    ),
    periods AS (
      SELECT
        generate_series(
          CASE WHEN grain.value = 'day' THEN bounds.date_from::timestamp ELSE date_trunc('month', bounds.date_from) END,
          CASE WHEN grain.value = 'day' THEN bounds.date_to::timestamp ELSE date_trunc('month', bounds.date_to) END,
          CASE WHEN grain.value = 'day' THEN interval '1 day' ELSE interval '1 month' END
        ) AS period_start,
        grain.value AS grain
      FROM bounds CROSS JOIN grain
    ),
    account_totals AS (
      SELECT
        CASE
          WHEN grain.value = 'day' THEN vm.voucher_date::date::timestamp
          ELSE date_trunc('month', vm.voucher_date)
        END AS period_start,
        vd.account_id,
        SUM(vd.debit_amount)::numeric AS debit,
        SUM(vd.credit_amount)::numeric AS credit
      FROM accounts.voucher_detail vd
      JOIN accounts.voucher_master vm
        ON vm.company_id = vd.company_id
       AND vm.branch_id = vd.branch_id
       AND vm.voucher_master_id = vd.voucher_master_id
      JOIN accounts.account_head_master ah
        ON ah.company_id = vd.company_id
       AND ah.account_id = vd.account_id
      CROSS JOIN grain
      WHERE vm.company_id = $1
        ${branch.sql}
        AND vm.record_status = 'ACTIVE'
        AND vd.record_status = 'ACTIVE'
        AND UPPER(COALESCE(vm.post_status, 'PENDING')) = 'POSTED'
        AND vm.voucher_date::date BETWEEN ${fromParam}::date AND ${toParam}::date
        AND ah.account_type = 'PL'
        AND COALESCE(ah.posting_allowed, 0) = 1
      GROUP BY period_start, vd.account_id
    )
    SELECT
      CASE WHEN p.grain = 'day'
        THEN to_char(p.period_start, 'DD Mon')
        ELSE to_char(p.period_start, 'Mon YY')
      END AS label,
      COALESCE(SUM(GREATEST(a.credit - a.debit, 0)), 0)::numeric AS revenue,
      COALESCE(SUM(GREATEST(a.debit - a.credit, 0)), 0)::numeric AS expenses
    FROM periods p
    LEFT JOIN account_totals a ON a.period_start = p.period_start
    GROUP BY p.period_start, p.grain
    ORDER BY p.period_start
  `, params);
  return rows;
}
