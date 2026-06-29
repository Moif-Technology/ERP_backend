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
           vt.voucher_name, vt.voucher_type_code,
           cm.customer_name, cm.customer_code,
           sm.supplier_name, sm.supplier_code,
           ctm_pick.transaction_id, ctm_pick.transaction_no, ctm_pick.status AS payment_status,
           ctm_pick.payment_mode, ctm_pick.post_dated_cheque, ctm_pick.cheque_details,
           ctm_pick.cheque_date, ctm_pick.transaction_date, ctm_pick.remarks AS payment_remarks,
           ctm_pick.modified_at AS payment_modified_at
    FROM accounts.voucher_master vm
    LEFT JOIN accounts.voucher_type_master vt
      ON vt.company_id = vm.company_id AND vt.voucher_type_id = vm.voucher_type_id
    LEFT JOIN LATERAL (
      SELECT ctm.customer_id, ctm.supplier_id, ctm.transaction_id, ctm.transaction_no,
             ctm.status, ctm.payment_mode, ctm.post_dated_cheque, ctm.cheque_details,
             ctm.cheque_date, ctm.transaction_date, ctm.remarks, ctm.modified_at
      FROM accounts.cash_transaction_master ctm
      WHERE ctm.company_id = vm.company_id
        AND ctm.branch_id = vm.branch_id
        AND (
          ctm.voucher_master_id = vm.voucher_master_id
          OR (vm.voucher_posted_id IS NOT NULL AND ctm.transaction_id = vm.voucher_posted_id)
        )
      ORDER BY
        CASE WHEN ctm.voucher_master_id = vm.voucher_master_id THEN 0 ELSE 1 END,
        ctm.transaction_id DESC
      LIMIT 1
    ) ctm_pick ON TRUE
    LEFT JOIN biz.customer_master cm
      ON cm.company_id = vm.company_id AND cm.customer_id = ctm_pick.customer_id
    LEFT JOIN biz.supplier_master sm
      ON sm.company_id = vm.company_id AND sm.supplier_id = ctm_pick.supplier_id
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

export async function listVouchersByPostedId(pool, companyId, branchId, postedId, creationMode = 'INVENTORYACCOUNTS') {
  const { rows: mRows } = await pool.query(
    `SELECT vm.*, vt.voucher_name, vt.voucher_type_code
     FROM accounts.voucher_master vm
     LEFT JOIN accounts.voucher_type_master vt
       ON vt.company_id = vm.company_id AND vt.voucher_type_id = vm.voucher_type_id
     WHERE vm.company_id = $1 AND vm.branch_id = $2 AND vm.voucher_posted_id = $3
       AND vm.creation_mode = $4 AND vm.record_status = 'ACTIVE'
     ORDER BY vm.voucher_master_id ASC`,
    [companyId, branchId, postedId, creationMode],
  );
  const out = [];
  for (const masterRow of mRows) {
    out.push(await loadVoucherDetails(pool, companyId, branchId, masterRow));
  }
  return out;
}

export async function updateVoucherMaster(client, companyId, branchId, voucherMasterId, fields = {}) {
  await client.query(
    `UPDATE accounts.voucher_master
     SET voucher_date = COALESCE($4, voucher_date),
         reference_no = COALESCE($5, reference_no),
         voucher_amount = COALESCE($6, voucher_amount),
         remarks = COALESCE($7, remarks),
         modified_at = NOW()
     WHERE company_id = $1 AND branch_id = $2 AND voucher_master_id = $3`,
    [
      companyId,
      branchId,
      voucherMasterId,
      fields.voucherDate ?? null,
      fields.referenceNo ?? null,
      fields.voucherAmount ?? null,
      fields.remarks ?? null,
    ],
  );
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

export async function getLedgerTransactions(pool, companyId, accountIds, { branchId, dateFrom, dateTo, page = 1, pageSize = 30 } = {}) {
  const ids = (Array.isArray(accountIds) ? accountIds : [accountIds])
    .map(Number)
    .filter((id) => id > 0);
  if (!ids.length) {
    return { total: 0, page: Math.max(1, page), pageSize, openDebit: 0, openCredit: 0, rows: [] };
  }

  const params = [companyId, ids];
  let where = 'vd.company_id = $1 AND vd.account_id = ANY($2::int[]) AND vd.record_status = \'ACTIVE\'';
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
    const openParams = [companyId, ids];
    let openWhere = 'vd.company_id = $1 AND vd.account_id = ANY($2::int[]) AND vd.record_status = \'ACTIVE\'';
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
      WHERE ${openWhere}
        AND vm.record_status = 'ACTIVE'
        AND UPPER(COALESCE(vm.post_status, 'PENDING')) = 'POSTED'`;
    const { rows: oRows } = await pool.query(openSql, openParams);
    openDebit = Number(oRows[0]?.dr || 0);
    openCredit = Number(oRows[0]?.cr || 0);
  }

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM accounts.voucher_detail vd
    JOIN accounts.voucher_master vm
      ON vm.company_id = vd.company_id AND vm.branch_id = vd.branch_id AND vm.voucher_master_id = vd.voucher_master_id
    WHERE ${where}
      AND vm.record_status = 'ACTIVE'
      AND UPPER(COALESCE(vm.post_status, 'PENDING')) = 'POSTED'`;
  const { rows: cRows } = await pool.query(countSql, params);
  const total = cRows[0]?.total || 0;

  const offset = (Math.max(1, page) - 1) * pageSize;
  params.push(pageSize, offset);
  const dataSql = `
    SELECT vd.voucher_detail_id, vd.voucher_master_id, vd.account_id,
           vd.debit_amount, vd.credit_amount,
           vd.narration, vm.voucher_date, vm.auto_voucher_no, vm.voucher_prefix,
           vm.reference_no, vm.post_status, vt.voucher_name, vt.voucher_type_code,
           vm.branch_id,
           ah.account_no, ah.account_head
    FROM accounts.voucher_detail vd
    JOIN accounts.voucher_master vm
      ON vm.company_id = vd.company_id AND vm.branch_id = vd.branch_id AND vm.voucher_master_id = vd.voucher_master_id
    LEFT JOIN accounts.voucher_type_master vt
      ON vt.company_id = vm.company_id AND vt.voucher_type_id = vm.voucher_type_id
    LEFT JOIN accounts.account_head_master ah
      ON ah.company_id = vd.company_id AND ah.account_id = vd.account_id
    WHERE ${where}
      AND vm.record_status = 'ACTIVE'
      AND UPPER(COALESCE(vm.post_status, 'PENDING')) = 'POSTED'
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

const PURCHASE_CLEARED_PAID_SUBQUERY = `
  COALESCE((
    SELECT SUM(ctc.paid_amount)::numeric
    FROM accounts.cash_transaction_child ctc
    LEFT JOIN accounts.cash_transaction_master ctm
      ON ctm.company_id = ctc.company_id AND ctm.transaction_id = ctc.transaction_id
    WHERE ctc.company_id = pm.company_id
      AND ctc.bill_id = pm.purchase_id
      AND ctm.supplier_id = pm.supplier_id
      AND ctm.customer_id IS NULL
      AND NOT (
        COALESCE(ctm.post_dated_cheque, false) = true
        AND UPPER(COALESCE(ctm.status, '')) = 'PDC_PENDING'
      )
  ), 0)`;

const PURCHASE_BILL_OUTSTANDING_EXPR = `
  CASE
    WHEN COALESCE(pm.outstanding_balance, 0) > 0.005 THEN COALESCE(pm.outstanding_balance, 0)
    ELSE GREATEST(COALESCE(pm.invoice_amount, 0) - ${PURCHASE_CLEARED_PAID_SUBQUERY}, 0)
  END`;

const SALES_CLEARED_PAID_SUBQUERY = `
  COALESCE((
    SELECT SUM(ctc.paid_amount)::numeric
    FROM accounts.cash_transaction_child ctc
    LEFT JOIN accounts.cash_transaction_master ctm
      ON ctm.company_id = ctc.company_id AND ctm.transaction_id = ctc.transaction_id
    WHERE ctc.company_id = sm.company_id
      AND ctc.bill_id = sm.sales_id
      AND ctm.customer_id = sm.customer_id
      AND ctm.supplier_id IS NULL
      AND NOT (
        COALESCE(ctm.post_dated_cheque, false) = true
        AND UPPER(COALESCE(ctm.status, '')) = 'PDC_PENDING'
      )
  ), 0)`;

const SALES_BILL_OUTSTANDING_EXPR = `
  GREATEST(
    COALESCE(
      NULLIF(sm.credit_amount::numeric, 0),
      CASE WHEN UPPER(TRIM(COALESCE(sm.payment_mode, ''))) = 'CREDIT' THEN sm.amount::numeric ELSE 0 END
    ) - ${SALES_CLEARED_PAID_SUBQUERY},
    0
  )`;

export async function getAgingSummary(pool, companyId, { branchId, summaryType, postStatus, dateFrom, dateTo } = {}) {
  const params = [companyId];
  let where = 'vd.company_id = $1 AND vd.record_status = \'ACTIVE\' AND vm.record_status = \'ACTIVE\'';
  if (branchId) { params.push(branchId); where += ` AND vd.branch_id = $${params.length}`; }
  if (postStatus) { params.push(postStatus); where += ` AND vm.post_status = $${params.length}`; }
  else { where += ` AND UPPER(COALESCE(vm.post_status, 'PENDING')) = 'POSTED'`; }
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

  const isPayable = summaryType === 'payable';
  const outstandingExpr = isPayable
    ? `CASE
         WHEN UPPER(COALESCE(vm.creation_mode, '')) = 'INVENTORYACCOUNTS'
          AND vm.voucher_posted_id IS NOT NULL
         AND pm.purchase_id IS NOT NULL
         AND vd.credit_amount > 0
         THEN GREATEST(${PURCHASE_BILL_OUTSTANDING_EXPR}, 0)
         WHEN vm.voucher_posted_id IS NULL
          AND vd.credit_amount > 0
         THEN GREATEST(COALESCE(NULLIF(vd.outstanding_balance, 0), vd.credit_amount - vd.debit_amount), 0)
         ELSE 0
       END`
    : `CASE
         WHEN UPPER(COALESCE(vm.creation_mode, '')) = 'INVENTORYACCOUNTS'
          AND vm.voucher_posted_id IS NOT NULL
          AND sm.sales_id IS NOT NULL
          AND vd.debit_amount > 0
         THEN GREATEST(${SALES_BILL_OUTSTANDING_EXPR}, 0)
         WHEN vm.voucher_posted_id IS NULL
          AND vd.debit_amount > 0
         THEN GREATEST(COALESCE(NULLIF(vd.outstanding_balance, 0), vd.debit_amount - vd.credit_amount), 0)
         ELSE 0
       END`;
  const billAmountExpr = isPayable
    ? `CASE WHEN (${outstandingExpr}) > 0.01 THEN vd.credit_amount ELSE 0 END`
    : `CASE WHEN (${outstandingExpr}) > 0.01 THEN vd.debit_amount ELSE 0 END`;

  const havingClause = `HAVING SUM(${outstandingExpr}) > 0.01`;
  const purchaseSummaryJoin = isPayable
    ? `LEFT JOIN ops.purchase_master pm
      ON pm.company_id = vm.company_id
     AND pm.branch_id = vm.branch_id
     AND pm.purchase_id = vm.voucher_posted_id
     AND UPPER(COALESCE(vm.creation_mode, '')) = 'INVENTORYACCOUNTS'`
    : `LEFT JOIN ops.sales_master sm
      ON sm.company_id = vm.company_id
     AND sm.branch_id = vm.branch_id
     AND sm.sales_id = vm.voucher_posted_id
     AND UPPER(COALESCE(vm.creation_mode, '')) = 'INVENTORYACCOUNTS'`;

  const sql = `
    SELECT
      ah.account_id,
      ah.account_no,
      ah.account_head,
      ah.account_type,
      COUNT(DISTINCT CASE WHEN (${outstandingExpr}) > 0.01 THEN vm.voucher_master_id END)::int AS bill_count,
      COALESCE(SUM(CASE WHEN ${isPayable ? 'FALSE' : `(${outstandingExpr}) > 0.01`} THEN vd.debit_amount ELSE 0 END), 0)::numeric  AS total_debit,
      COALESCE(SUM(${billAmountExpr}), 0)::numeric AS total_credit,
      COALESCE(SUM(${outstandingExpr}), 0)::numeric AS outstanding,
      MAX(CASE WHEN (${outstandingExpr}) > 0.01 THEN vm.voucher_date ELSE NULL END) AS last_bill_date,
      COALESCE(SUM(CASE WHEN (${outstandingExpr}) > 0.01 AND NOW()::date - vm.voucher_date::date <= 30
        THEN ${outstandingExpr} ELSE 0 END), 0)::numeric AS age_0_30,
      COALESCE(SUM(CASE WHEN (${outstandingExpr}) > 0.01 AND NOW()::date - vm.voucher_date::date BETWEEN 31 AND 60
        THEN ${outstandingExpr} ELSE 0 END), 0)::numeric AS age_30_60,
      COALESCE(SUM(CASE WHEN (${outstandingExpr}) > 0.01 AND NOW()::date - vm.voucher_date::date BETWEEN 61 AND 120
        THEN ${outstandingExpr} ELSE 0 END), 0)::numeric AS age_60_120,
      COALESCE(SUM(CASE WHEN (${outstandingExpr}) > 0.01 AND NOW()::date - vm.voucher_date::date > 120
        THEN ${outstandingExpr} ELSE 0 END), 0)::numeric AS age_120_plus
    FROM accounts.voucher_detail vd
    JOIN accounts.voucher_master vm
      ON vm.company_id = vd.company_id AND vm.branch_id = vd.branch_id AND vm.voucher_master_id = vd.voucher_master_id
    ${purchaseSummaryJoin}
    JOIN accounts.account_head_master ah
      ON ah.company_id = vd.company_id AND ah.account_id = vd.account_id
    WHERE ${where}
    GROUP BY ah.account_id, ah.account_no, ah.account_head, ah.account_type
    ${havingClause}
    ORDER BY outstanding DESC`;
  const { rows } = await pool.query(sql, params);
  return rows;
}

/** PDC allocations apply to sales bills (bill_id = sales_id), not receipt vouchers. */
const PDC_BILL_LINK_SQL = `
  (
    (
      UPPER(COALESCE(vm.creation_mode, '')) = 'INVENTORYACCOUNTS'
      AND vm.voucher_posted_id IS NOT NULL
      AND ctc.bill_id = vm.voucher_posted_id
    )
    OR (
      vm.voucher_posted_id IS NULL
      AND ctc.bill_id = (-vm.voucher_master_id)::bigint
    )
  )`;

const PDC_PENDING_SUBQUERY = `
  COALESCE((
    SELECT SUM(ctc.paid_amount)::numeric
    FROM accounts.cash_transaction_child ctc
    INNER JOIN accounts.cash_transaction_master ctm
      ON ctm.company_id = ctc.company_id AND ctm.transaction_id = ctc.transaction_id
    WHERE ctc.company_id = vd.company_id
      AND COALESCE(ctm.post_dated_cheque, false) = true
      AND UPPER(COALESCE(ctm.status, '')) = 'PDC_PENDING'
      AND ${PDC_BILL_LINK_SQL}
  ), 0)`;

export async function getAgingDetail(pool, companyId, accountId, { branchId, summaryType, postStatus, dateFrom, dateTo } = {}) {
  const params = [companyId, accountId];
  let where = 'vd.company_id = $1 AND vd.account_id = $2 AND vd.record_status = \'ACTIVE\' AND vm.record_status = \'ACTIVE\'';
  if (branchId) { params.push(branchId); where += ` AND vd.branch_id = $${params.length}`; }
  if (postStatus) { params.push(postStatus); where += ` AND vm.post_status = $${params.length}`; }
  if (dateFrom) { params.push(dateFrom); where += ` AND vm.voucher_date >= $${params.length}::date`; }
  if (dateTo) { params.push(dateTo); where += ` AND vm.voucher_date < ($${params.length}::date + interval '1 day')`; }

  const isPayable = summaryType === 'payable';
  const outstandingExpr = isPayable
    ? `CASE
         WHEN UPPER(COALESCE(vm.creation_mode, '')) = 'INVENTORYACCOUNTS'
          AND vm.voucher_posted_id IS NOT NULL
          AND pm.purchase_id IS NOT NULL
          AND vd.credit_amount > 0
         THEN GREATEST(${PURCHASE_BILL_OUTSTANDING_EXPR}, 0)
         ELSE GREATEST(COALESCE(NULLIF(vd.outstanding_balance, 0), vd.credit_amount - vd.debit_amount), 0)
       END`
    : `CASE
         WHEN UPPER(COALESCE(vm.creation_mode, '')) = 'INVENTORYACCOUNTS'
          AND vm.voucher_posted_id IS NOT NULL
          AND sm.sales_id IS NOT NULL
          AND vd.debit_amount > 0
         THEN GREATEST(${SALES_BILL_OUTSTANDING_EXPR}, 0)
         WHEN vm.voucher_posted_id IS NULL
          AND vd.debit_amount > 0
         THEN GREATEST(COALESCE(NULLIF(vd.outstanding_balance, 0), vd.debit_amount - vd.credit_amount), 0)
         ELSE 0
       END`;

  const inventoryBillJoin = isPayable
    ? `LEFT JOIN ops.purchase_master pm
      ON pm.company_id = vm.company_id
     AND pm.branch_id = vm.branch_id
     AND pm.purchase_id = vm.voucher_posted_id
     AND UPPER(COALESCE(vm.creation_mode, '')) = 'INVENTORYACCOUNTS'`
    : `LEFT JOIN ops.sales_master sm
      ON sm.company_id = vm.company_id
     AND sm.branch_id = vm.branch_id
     AND sm.sales_id = vm.voucher_posted_id
     AND UPPER(COALESCE(vm.creation_mode, '')) = 'INVENTORYACCOUNTS'`;

  const inventoryBillPostedFilter = isPayable
    ? `UPPER(COALESCE(pm.post_status, 'PENDING')) = 'POSTED'`
    : `UPPER(COALESCE(sm.post_status, 'PENDING')) = 'POSTED'`;

  const sql = `
    SELECT
      vm.voucher_master_id,
      vm.voucher_date,
      vm.auto_voucher_no,
      vm.voucher_prefix,
      vm.reference_no,
      vm.post_status,
      vt.voucher_name,
      vt.voucher_type_code,
      vd.debit_amount,
      vd.credit_amount,
      (${outstandingExpr})::numeric AS outstanding,
      ${PDC_PENDING_SUBQUERY}::numeric AS pdc_pending,
      vd.narration,
      (NOW()::date - vm.voucher_date::date)::int AS age_days
    FROM accounts.voucher_detail vd
    JOIN accounts.voucher_master vm
      ON vm.company_id = vd.company_id AND vm.branch_id = vd.branch_id AND vm.voucher_master_id = vd.voucher_master_id
    ${inventoryBillJoin}
    LEFT JOIN accounts.voucher_type_master vt
      ON vt.company_id = vm.company_id AND vt.voucher_type_id = vm.voucher_type_id
    WHERE ${where}
      AND (
        (
          UPPER(COALESCE(vm.creation_mode, '')) = 'INVENTORYACCOUNTS'
          AND vm.voucher_posted_id IS NOT NULL
          AND UPPER(COALESCE(vm.post_status, 'PENDING')) = 'POSTED'
          AND ${inventoryBillPostedFilter}
        )
        OR (
          vm.voucher_posted_id IS NULL
          AND UPPER(COALESCE(vm.post_status, 'PENDING')) = 'POSTED'
        )
      )
      AND ((${outstandingExpr}) > 0.01 OR ${PDC_PENDING_SUBQUERY} > 0.01)
    ORDER BY vm.voucher_date DESC, vm.voucher_master_id DESC`;
  const { rows } = await pool.query(sql, params);
  return rows;
}
