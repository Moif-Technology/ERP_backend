/**
 * accounts.voucher_master + voucher_detail — double-entry journal.
 */

export async function nextVoucherMasterId(client, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(voucher_master_id), 0) + 1 AS n
     FROM accounts.voucher_master WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId],
  );
  return Number(rows[0].n);
}

export async function nextAutoVoucherNo(client, companyId, branchId, voucherTypeId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(auto_voucher_no), 0) + 1 AS n
     FROM accounts.voucher_master
     WHERE company_id = $1 AND branch_id = $2 AND voucher_type_id = $3`,
    [companyId, branchId, voucherTypeId],
  );
  return Number(rows[0].n);
}

export async function nextVoucherDetailId(client, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(voucher_detail_id), 0) + 1 AS n
     FROM accounts.voucher_detail WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId],
  );
  return Number(rows[0].n);
}

export async function insertVoucherMaster(client, row) {
  const manualNo = row.manualVoucherNo != null && row.manualVoucherNo !== ''
    ? String(row.manualVoucherNo)
    : String(row.autoVoucherNo);

  await client.query(
    `INSERT INTO accounts.voucher_master (
       company_id, branch_id, voucher_master_id, voucher_type_id,
       auto_voucher_no, manual_voucher_no, voucher_prefix, voucher_date,
       reference_no, voucher_amount, remarks, post_status, creation_mode,
       voucher_posted_id, counter_close_no, record_status,
       created_at, created_by, modified_at, modified_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),$17,NOW(),$17)`,
    [
      row.companyId, row.branchId, row.voucherMasterId, row.voucherTypeId,
      row.autoVoucherNo, manualNo, row.voucherPrefix,
      row.voucherDate || new Date(), row.referenceNo, row.voucherAmount,
      row.remarks, row.postStatus, row.creationMode, row.voucherPostedId,
      row.counterCloseNo, row.recordStatus, row.createdBy,
    ],
  );
  return row.voucherMasterId;
}

export async function insertVoucherDetail(client, row) {
  await client.query(
    `INSERT INTO accounts.voucher_detail (
       company_id, branch_id, voucher_detail_id, voucher_master_id,
       account_id, credit_amount, debit_amount, outstanding_balance,
       narration, post_status, record_status,
       created_at, created_by, modified_at, modified_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),$12,NOW(),$12)`,
    [
      row.companyId, row.branchId, row.voucherDetailId, row.voucherMasterId,
      row.accountId, row.creditAmount, row.debitAmount, row.outstandingBalance,
      row.narration, row.postStatus, row.recordStatus, row.createdBy,
    ],
  );
}

export async function getVoucherTypeId(client, companyId, parameterName, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(numeric_value, account_id) AS type_id FROM accounts.accounts_parameter
     WHERE company_id = $1 AND branch_id = $2 AND parameter_name = $3`,
    [companyId, branchId, parameterName],
  );
  return rows[0]?.type_id ? Number(rows[0].type_id) : null;
}

export async function getVoucherTypeIdByCode(client, companyId, voucherTypeCode) {
  const { rows } = await client.query(
    `SELECT voucher_type_id FROM accounts.voucher_type_master
     WHERE company_id = $1 AND voucher_type_code = $2 AND record_status = 'ACTIVE'
     LIMIT 1`,
    [companyId, voucherTypeCode],
  );
  return rows[0]?.voucher_type_id ? Number(rows[0].voucher_type_id) : null;
}

export async function getVoucherPrefix(client, companyId, voucherTypeId) {
  const { rows } = await client.query(
    `SELECT voucher_prefix FROM accounts.voucher_type_master
     WHERE company_id = $1 AND voucher_type_id = $2`,
    [companyId, voucherTypeId],
  );
  return rows[0]?.voucher_prefix || '';
}

/* ──────────── list / read / update / delete ──────────── */

export async function listVouchers(pool, companyId, { branchId, voucherTypeId, postStatus, dateFrom, dateTo, page = 1, pageSize = 20 } = {}) {
  const params = [companyId];
  let where = 'vm.company_id = $1 AND vm.record_status = \'ACTIVE\'';
  if (branchId) { params.push(branchId); where += ` AND vm.branch_id = $${params.length}`; }
  if (voucherTypeId) { params.push(voucherTypeId); where += ` AND vm.voucher_type_id = $${params.length}`; }
  if (postStatus) { params.push(postStatus); where += ` AND vm.post_status = $${params.length}`; }
  if (dateFrom) { params.push(dateFrom); where += ` AND vm.voucher_date >= $${params.length}::date`; }
  if (dateTo) { params.push(dateTo); where += ` AND vm.voucher_date <= ($${params.length}::date + interval '1 day')`; }

  const countSql = `SELECT COUNT(*)::int AS total FROM accounts.voucher_master vm WHERE ${where}`;
  const { rows: cRows } = await pool.query(countSql, params);
  const total = cRows[0]?.total || 0;

  const offset = (Math.max(1, page) - 1) * pageSize;
  params.push(pageSize, offset);
  const dataSql = `
    SELECT vm.voucher_master_id, vm.voucher_type_id, vm.auto_voucher_no,
           vm.voucher_prefix, vm.voucher_date, vm.reference_no, vm.voucher_amount,
           vm.remarks, vm.post_status, vm.creation_mode, vm.branch_id,
           vt.voucher_name, vt.voucher_type_code
    FROM accounts.voucher_master vm
    LEFT JOIN accounts.voucher_type_master vt
      ON vt.company_id = vm.company_id AND vt.voucher_type_id = vm.voucher_type_id
    WHERE ${where}
    ORDER BY vm.voucher_date DESC, vm.voucher_master_id DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const { rows } = await pool.query(dataSql, params);
  return { total, page, pageSize, rows };
}

export async function getVoucherWithDetails(pool, companyId, branchId, voucherMasterId) {
  const { rows: mRows } = await pool.query(
    `SELECT vm.*, vt.voucher_name, vt.voucher_type_code
     FROM accounts.voucher_master vm
     LEFT JOIN accounts.voucher_type_master vt
       ON vt.company_id = vm.company_id AND vt.voucher_type_id = vm.voucher_type_id
     WHERE vm.company_id = $1 AND vm.branch_id = $2 AND vm.voucher_master_id = $3
       AND vm.record_status = 'ACTIVE'
     LIMIT 1`,
    [companyId, branchId, voucherMasterId],
  );
  if (!mRows[0]) return null;
  return loadVoucherDetails(pool, companyId, branchId, mRows[0]);
}

export async function getVoucherWithDetailsById(pool, companyId, voucherMasterId) {
  const { rows: mRows } = await pool.query(
    `SELECT vm.*, vt.voucher_name, vt.voucher_type_code
     FROM accounts.voucher_master vm
     LEFT JOIN accounts.voucher_type_master vt
       ON vt.company_id = vm.company_id AND vt.voucher_type_id = vm.voucher_type_id
     WHERE vm.company_id = $1 AND vm.voucher_master_id = $2
       AND vm.record_status = 'ACTIVE'
     LIMIT 1`,
    [companyId, voucherMasterId],
  );
  if (!mRows[0]) return null;
  return loadVoucherDetails(pool, companyId, Number(mRows[0].branch_id), mRows[0]);
}

async function loadVoucherDetails(pool, companyId, branchId, masterRow) {
  const voucherMasterId = masterRow.voucher_master_id;
  const { rows: dRows } = await pool.query(
    `SELECT vd.voucher_detail_id, vd.account_id, vd.debit_amount, vd.credit_amount,
            vd.outstanding_balance, vd.narration, vd.post_status,
            ah.account_no, ah.account_head
     FROM accounts.voucher_detail vd
     LEFT JOIN accounts.account_head_master ah
       ON ah.company_id = vd.company_id AND ah.account_id = vd.account_id
     WHERE vd.company_id = $1 AND vd.branch_id = $2 AND vd.voucher_master_id = $3
       AND vd.record_status = 'ACTIVE'
     ORDER BY vd.voucher_detail_id ASC`,
    [companyId, branchId, voucherMasterId],
  );
  return { master: masterRow, details: dRows };
}

export async function updateVoucherPostStatus(client, companyId, branchId, voucherMasterId, postStatus) {
  await client.query(
    `UPDATE accounts.voucher_master SET post_status = $4, modified_at = NOW()
     WHERE company_id = $1 AND branch_id = $2 AND voucher_master_id = $3`,
    [companyId, branchId, voucherMasterId, postStatus],
  );
  await client.query(
    `UPDATE accounts.voucher_detail SET post_status = $4, modified_at = NOW()
     WHERE company_id = $1 AND branch_id = $2 AND voucher_master_id = $3`,
    [companyId, branchId, voucherMasterId, postStatus],
  );
}

export async function softDeleteVoucher(client, companyId, branchId, voucherMasterId) {
  await client.query(
    `UPDATE accounts.voucher_master SET record_status = 'DELETED', modified_at = NOW()
     WHERE company_id = $1 AND branch_id = $2 AND voucher_master_id = $3`,
    [companyId, branchId, voucherMasterId],
  );
  await client.query(
    `UPDATE accounts.voucher_detail SET record_status = 'DELETED', modified_at = NOW()
     WHERE company_id = $1 AND branch_id = $2 AND voucher_master_id = $3`,
    [companyId, branchId, voucherMasterId],
  );
}

export async function deleteVoucherDetails(client, companyId, branchId, voucherMasterId) {
  await client.query(
    `DELETE FROM accounts.voucher_detail
     WHERE company_id = $1 AND branch_id = $2 AND voucher_master_id = $3`,
    [companyId, branchId, voucherMasterId],
  );
}

export async function listVoucherTypes(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT voucher_type_id, voucher_type_code, voucher_name, voucher_name_alias,
            voucher_prefix, numbering_method, record_status
     FROM accounts.voucher_type_master
     WHERE company_id = $1 AND record_status = 'ACTIVE'
     ORDER BY voucher_type_id ASC`,
    [companyId],
  );
  return rows;
}

/* ──────────── ledger view (transactions for one account) ──────────── */

export async function getLedgerTransactions(pool, companyId, accountId, { branchId, dateFrom, dateTo, page = 1, pageSize = 30 } = {}) {
  const params = [companyId, accountId];
  let where = 'vd.company_id = $1 AND vd.account_id = $2 AND vd.record_status = \'ACTIVE\'';
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

  let openDebit = 0;
  let openCredit = 0;
  if (dateFrom) {
    const openParams = [companyId, accountId];
    let openWhere = 'vd.company_id = $1 AND vd.account_id = $2 AND vd.record_status = \'ACTIVE\'';
    if (branchId) {
      openParams.push(branchId);
      openWhere += ` AND vd.branch_id = $${openParams.length}`;
    }
    openParams.push(dateFrom);
    openWhere += ` AND vm.voucher_date < $${openParams.length}::date`;
    const openSql = `
      SELECT COALESCE(SUM(vd.debit_amount), 0)::numeric AS dr,
             COALESCE(SUM(vd.credit_amount), 0)::numeric AS cr
      FROM accounts.voucher_detail vd
      JOIN accounts.voucher_master vm
        ON vm.company_id = vd.company_id AND vm.branch_id = vd.branch_id AND vm.voucher_master_id = vd.voucher_master_id
      WHERE ${openWhere} AND vm.record_status = 'ACTIVE'`;
    const { rows: oRows } = await pool.query(openSql, openParams);
    openDebit = Number(oRows[0]?.dr || 0);
    openCredit = Number(oRows[0]?.cr || 0);
  }

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM accounts.voucher_detail vd
    JOIN accounts.voucher_master vm
      ON vm.company_id = vd.company_id AND vm.branch_id = vd.branch_id AND vm.voucher_master_id = vd.voucher_master_id
    WHERE ${where} AND vm.record_status = 'ACTIVE'`;
  const { rows: cRows } = await pool.query(countSql, params);
  const total = cRows[0]?.total || 0;

  const offset = (Math.max(1, page) - 1) * pageSize;
  params.push(pageSize, offset);
  const dataSql = `
    SELECT vd.voucher_detail_id, vd.voucher_master_id, vd.debit_amount, vd.credit_amount,
           vd.narration, vm.voucher_date, vm.auto_voucher_no, vm.voucher_prefix,
           vm.reference_no, vm.post_status, vt.voucher_name, vt.voucher_type_code,
           vm.branch_id
    FROM accounts.voucher_detail vd
    JOIN accounts.voucher_master vm
      ON vm.company_id = vd.company_id AND vm.branch_id = vd.branch_id AND vm.voucher_master_id = vd.voucher_master_id
    LEFT JOIN accounts.voucher_type_master vt
      ON vt.company_id = vm.company_id AND vt.voucher_type_id = vm.voucher_type_id
    WHERE ${where} AND vm.record_status = 'ACTIVE'
    ORDER BY vm.voucher_date ASC, vd.voucher_detail_id ASC
    LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const { rows } = await pool.query(dataSql, params);
  return { total, page, pageSize, openDebit, openCredit, rows };
}

/* ──────────── trial balance ──────────── */

export async function getTrialBalance(pool, companyId, { branchId, dateTo } = {}) {
  const params = [companyId];
  let where = 'vd.company_id = $1 AND vd.record_status = \'ACTIVE\'';
  if (branchId) { params.push(branchId); where += ` AND vd.branch_id = $${params.length}`; }
  if (dateTo) { params.push(dateTo); where += ` AND vm.voucher_date <= ($${params.length}::date + interval '1 day')`; }

  const sql = `
    SELECT vd.account_id,
           ah.account_no, ah.account_head, ah.account_type, ah.parent_acc_id,
           COALESCE(SUM(vd.debit_amount), 0)::numeric AS total_debit,
           COALESCE(SUM(vd.credit_amount), 0)::numeric AS total_credit
    FROM accounts.voucher_detail vd
    JOIN accounts.voucher_master vm
      ON vm.company_id = vd.company_id AND vm.branch_id = vd.branch_id AND vm.voucher_master_id = vd.voucher_master_id
    LEFT JOIN accounts.account_head_master ah
      ON ah.company_id = vd.company_id AND ah.account_id = vd.account_id
    WHERE ${where} AND vm.record_status = 'ACTIVE'
    GROUP BY vd.account_id, ah.account_no, ah.account_head, ah.account_type, ah.parent_acc_id
    ORDER BY ah.account_no ASC, vd.account_id ASC`;
  const { rows } = await pool.query(sql, params);
  return rows;
}

/* ──────────── aging summary (payable / receivable) ──────────── */

export async function getAgingSummary(pool, companyId, { branchId, summaryType, postStatus, dateFrom, dateTo } = {}) {
  const params = [companyId];
  let where = 'vd.company_id = $1 AND vd.record_status = \'ACTIVE\' AND vm.record_status = \'ACTIVE\'';
  if (branchId) { params.push(branchId); where += ` AND vd.branch_id = $${params.length}`; }
  if (postStatus) { params.push(postStatus); where += ` AND vm.post_status = $${params.length}`; }
  if (dateFrom) { params.push(dateFrom); where += ` AND vm.voucher_date >= $${params.length}::date`; }
  if (dateTo) { params.push(dateTo); where += ` AND vm.voucher_date < ($${params.length}::date + interval '1 day')`; }

  // Receivable = party ledgers under Sundry Debtors; Payable = under Sundry Creditors
  if (summaryType === 'payable') {
    where += ` AND (
      ah.parent_acc_id = (
        SELECT account_id FROM accounts.account_head_master
        WHERE company_id = $1 AND account_no = '04-01'
          AND (record_status IS NULL OR TRIM(UPPER(record_status)) = 'ACTIVE')
        LIMIT 1
      )
      OR ah.account_no = '04-01'
    )`;
  } else {
    where += ` AND (
      ah.parent_acc_id = (
        SELECT account_id FROM accounts.account_head_master
        WHERE company_id = $1 AND account_no = '03-04'
          AND (record_status IS NULL OR TRIM(UPPER(record_status)) = 'ACTIVE')
        LIMIT 1
      )
      OR ah.account_no IN (
        SELECT customer_code FROM biz.customer_master
        WHERE company_id = $1 AND COALESCE(status, 'ACTIVE') = 'ACTIVE'
      )
    )`;
  }

  const havingClause = summaryType === 'payable'
    ? 'HAVING SUM(vd.credit_amount) - SUM(vd.debit_amount) > 0.01'
    : 'HAVING SUM(vd.debit_amount) - SUM(vd.credit_amount) > 0.01';

  const sql = `
    SELECT
      ah.account_id,
      ah.account_no,
      ah.account_head,
      ah.account_type,
      COUNT(DISTINCT vm.voucher_master_id)::int AS bill_count,
      COALESCE(SUM(vd.debit_amount), 0)::numeric  AS total_debit,
      COALESCE(SUM(vd.credit_amount), 0)::numeric AS total_credit,
      ABS(COALESCE(SUM(vd.debit_amount), 0) - COALESCE(SUM(vd.credit_amount), 0))::numeric AS outstanding,
      MAX(vm.voucher_date) AS last_bill_date,
      COALESCE(SUM(CASE WHEN NOW()::date - vm.voucher_date::date <= 30
        THEN ABS(vd.debit_amount - vd.credit_amount) ELSE 0 END), 0)::numeric AS age_0_30,
      COALESCE(SUM(CASE WHEN NOW()::date - vm.voucher_date::date BETWEEN 31 AND 60
        THEN ABS(vd.debit_amount - vd.credit_amount) ELSE 0 END), 0)::numeric AS age_30_60,
      COALESCE(SUM(CASE WHEN NOW()::date - vm.voucher_date::date BETWEEN 61 AND 120
        THEN ABS(vd.debit_amount - vd.credit_amount) ELSE 0 END), 0)::numeric AS age_60_120,
      COALESCE(SUM(CASE WHEN NOW()::date - vm.voucher_date::date > 120
        THEN ABS(vd.debit_amount - vd.credit_amount) ELSE 0 END), 0)::numeric AS age_120_plus
    FROM accounts.voucher_detail vd
    JOIN accounts.voucher_master vm
      ON vm.company_id = vd.company_id AND vm.branch_id = vd.branch_id AND vm.voucher_master_id = vd.voucher_master_id
    JOIN accounts.account_head_master ah
      ON ah.company_id = vd.company_id AND ah.account_id = vd.account_id
    WHERE ${where}
    GROUP BY ah.account_id, ah.account_no, ah.account_head, ah.account_type
    ${havingClause}
    ORDER BY outstanding DESC`;
  const { rows } = await pool.query(sql, params);
  return rows;
}
