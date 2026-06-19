/**
 * Account balances and financial statement queries.
 */

export async function getAccountBalances(pool, companyId, { branchId, dateFrom, dateTo, postStatus } = {}) {
  const params = [companyId];
  let balWhere = `vd.company_id = $1 AND vd.record_status = 'ACTIVE' AND vm.record_status = 'ACTIVE'`;
  if (branchId) {
    params.push(branchId);
    balWhere += ` AND vd.branch_id = $${params.length}`;
  }
  if (postStatus) {
    params.push(postStatus);
    balWhere += ` AND vm.post_status = $${params.length}`;
  }
  if (dateFrom) {
    params.push(dateFrom);
    balWhere += ` AND vm.voucher_date >= $${params.length}::date`;
  }
  if (dateTo) {
    params.push(dateTo);
    balWhere += ` AND vm.voucher_date < ($${params.length}::date + interval '1 day')`;
  }

  const sql = `
    SELECT ah.account_id,
           ah.account_no,
           ah.account_head,
           ah.account_type,
           ah.parent_acc_id,
           ah.posting_allowed,
           ah.level_no,
           ah.group_type,
           ah.account_balance_type,
           COALESCE(bal.total_debit, 0)::numeric AS total_debit,
           COALESCE(bal.total_credit, 0)::numeric AS total_credit
    FROM accounts.account_head_master ah
    LEFT JOIN (
      SELECT vd.account_id,
             SUM(vd.debit_amount) AS total_debit,
             SUM(vd.credit_amount) AS total_credit
      FROM accounts.voucher_detail vd
      JOIN accounts.voucher_master vm
        ON vm.company_id = vd.company_id
       AND vm.branch_id = vd.branch_id
       AND vm.voucher_master_id = vd.voucher_master_id
      WHERE ${balWhere}
      GROUP BY vd.account_id
    ) bal ON bal.account_id = ah.account_id
    WHERE ah.company_id = $1
      AND (ah.record_status IS NULL OR TRIM(UPPER(ah.record_status)) = 'ACTIVE')
    ORDER BY ah.account_no ASC, ah.account_id ASC`;
  const { rows } = await pool.query(sql, params);
  return rows;
}

/** Party ledgers under Sundry Debtors (03-04) or Sundry Creditors (04-01). */
export async function listPartyLedgerAccounts(pool, companyId, { partyType } = {}) {
  const parentNo = partyType === 'payable' ? '04-01' : '03-04';
  const { rows } = await pool.query(
    `SELECT ah.account_id, ah.account_no, ah.account_head, ah.account_type, ah.parent_acc_id, ah.posting_allowed
     FROM accounts.account_head_master ah
     WHERE ah.company_id = $1
       AND (ah.record_status IS NULL OR TRIM(UPPER(ah.record_status)) = 'ACTIVE')
       AND ah.posting_allowed = 1
       AND (
         ah.parent_acc_id = (
           SELECT account_id FROM accounts.account_head_master
           WHERE company_id = $1 AND account_no = $2
             AND (record_status IS NULL OR TRIM(UPPER(record_status)) = 'ACTIVE')
           LIMIT 1
         )
         OR (
           $3 = 'receivable'
           AND ah.account_no IN (
             SELECT customer_code FROM biz.customer_master
             WHERE company_id = $1 AND COALESCE(status, 'ACTIVE') = 'ACTIVE'
           )
         )
       )
     ORDER BY ah.account_no ASC, ah.account_head ASC`,
    [companyId, parentNo, partyType === 'payable' ? 'payable' : 'receivable'],
  );
  return rows;
}
