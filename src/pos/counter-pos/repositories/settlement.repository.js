/**
 * Credit settlement — outstanding bills + cash_transaction_master/child.
 */
import { debitBillOsExpr, VD_DEBIT_LINE_OS_EXPR } from '../../../accounts/lib/voucherOutstanding.js';

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function mapBillRow(r) {
  return {
    billId:        Number(r.bill_id),
    billNo:        Number(r.bill_no),
    billDate:      r.bill_date,
    invoiceNo:     r.invoice_no,
    invoiceAmount: num(r.invoice_amount),
    currentAmount: num(r.current_amount),
    pdcPending:    num(r.pdc_pending),
    clearedPaid:   num(r.cleared_paid),
  };
}

/** Join condition: receipt is pending PDC (cheque not yet cleared). */
const PDC_PENDING_MASTER_SQL = `
  COALESCE(ctm.post_dated_cheque, false) = true
  AND UPPER(COALESCE(ctm.status, '')) = 'PDC_PENDING'`;

/** Cleared payments only — PDC pending does not reduce bill O/S until cheque clears. */
const CLEARED_PAID_SUBQUERY = `
  COALESCE((
    SELECT SUM(ctc.paid_amount)::numeric
    FROM accounts.cash_transaction_child ctc
    LEFT JOIN accounts.cash_transaction_master ctm
      ON ctm.company_id = ctc.company_id AND ctm.transaction_id = ctc.transaction_id
    WHERE ctc.company_id = sm.company_id
      AND ctc.bill_id = sm.sales_id
      AND NOT (${PDC_PENDING_MASTER_SQL})
  ), 0)`;

/** PDC given against bill — cheque received but not yet cleared. */
const PDC_PAID_SUBQUERY = `
  COALESCE((
    SELECT SUM(ctc.paid_amount)::numeric
    FROM accounts.cash_transaction_child ctc
    INNER JOIN accounts.cash_transaction_master ctm
      ON ctm.company_id = ctc.company_id AND ctm.transaction_id = ctc.transaction_id
    WHERE ctc.company_id = sm.company_id
      AND ctc.bill_id = sm.sales_id
      AND (${PDC_PENDING_MASTER_SQL})
  ), 0)`;

/** Credit bills only — cash / card are fully paid (O/S = 0). */
const CREDIT_BILL_MODE_SQL = `
  (
    UPPER(TRIM(COALESCE(sm.payment_mode, ''))) = 'CREDIT'
    OR (
      UPPER(TRIM(COALESCE(sm.payment_mode, ''))) IN ('MULTIPAYMENT', 'MULTIPAY')
      AND COALESCE(sm.credit_amount, 0) > 0.005
    )
  )`;

/** Only posted sales / vouchers are payable via receipt or payment allocation. */
const POSTED_SALE_STATUS_SQL = `AND UPPER(COALESCE(sm.post_status, 'PENDING')) = 'POSTED'`;
const POSTED_VOUCHER_STATUS_SQL = `AND UPPER(COALESCE(vm.post_status, 'PENDING')) = 'POSTED'`;

const BASE_DUE_EXPR = `
  GREATEST(
    COALESCE(
      NULLIF(sm.outstanding_balance::numeric, 0),
      NULLIF(sm.credit_amount::numeric, 0),
      CASE WHEN UPPER(TRIM(COALESCE(sm.payment_mode, ''))) = 'CREDIT' THEN sm.amount::numeric ELSE 0 END
    ) - ${CLEARED_PAID_SUBQUERY},
    0
  )`;

/** Open credit sales for a customer (credit / multipay-credit only). */
const SALES_OUTSTANDING_SQL = `
  SELECT
    sm.sales_id AS bill_id,
    sm.bill_no,
    sm.bill_date,
    sm.amount::numeric AS invoice_amount,
    ${BASE_DUE_EXPR} AS current_amount,
    ${PDC_PAID_SUBQUERY} AS pdc_pending,
    ${CLEARED_PAID_SUBQUERY} AS cleared_paid,
    TRIM(COALESCE(sm.bill_no, sm.sales_id)::text) AS invoice_no
  FROM ops.sales_master sm
  WHERE sm.company_id = $1
    AND sm.customer_id = $2
    AND sm.amount > 0
    AND ${CREDIT_BILL_MODE_SQL}
    AND COALESCE(UPPER(sm.transaction_type), 'SALE') NOT IN ('RETURN', 'REFUND')
    AND COALESCE(UPPER(sm.hold_status), '') NOT IN ('HOLD', 'HELD', 'DELIVERY')
    ${POSTED_SALE_STATUS_SQL}
    AND (${BASE_DUE_EXPR} > 0.005 OR ${PDC_PAID_SUBQUERY} > 0.005)
  ORDER BY sm.bill_date ASC, sm.sales_id ASC`;

const VOUCHER_LINE_DUE_EXPR = debitBillOsExpr(CLEARED_PAID_SUBQUERY);

/** Fallback: open DR lines on customer ledger linked to posted sales vouchers. */
const VOUCHER_OUTSTANDING_SQL = `
  SELECT
    vm.voucher_posted_id AS bill_id,
    COALESCE(sm.bill_no, vm.voucher_posted_id) AS bill_no,
    COALESCE(sm.bill_date, vm.voucher_date) AS bill_date,
    COALESCE(sm.amount, vm.voucher_amount)::numeric AS invoice_amount,
    ${VOUCHER_LINE_DUE_EXPR} AS current_amount,
    TRIM(COALESCE(vm.voucher_prefix, 'SV-') || COALESCE(vm.auto_voucher_no, vm.voucher_posted_id)::text) AS invoice_no
  FROM accounts.voucher_detail vd
  INNER JOIN accounts.voucher_master vm
    ON vm.company_id = vd.company_id
   AND vm.voucher_master_id = vd.voucher_master_id
  INNER JOIN biz.customer_master cm
    ON cm.company_id = $1
   AND cm.customer_id = $2
  INNER JOIN accounts.account_head_master ah
    ON ah.company_id = cm.company_id
   AND ah.account_no = cm.customer_code
   AND (ah.record_status IS NULL OR TRIM(UPPER(ah.record_status)) = 'ACTIVE')
  LEFT JOIN ops.sales_master sm
    ON sm.company_id = vm.company_id
   AND sm.sales_id = vm.voucher_posted_id
  WHERE vd.company_id = $1
    AND vd.account_id = ah.account_id
    AND vd.debit_amount > 0
    AND vm.voucher_posted_id IS NOT NULL
    AND (vd.record_status IS NULL OR TRIM(UPPER(vd.record_status)) = 'ACTIVE')
    ${POSTED_VOUCHER_STATUS_SQL}
    AND (sm.sales_id IS NULL OR UPPER(COALESCE(sm.post_status, 'PENDING')) = 'POSTED')
    AND ${VOUCHER_LINE_DUE_EXPR} > 0.005
  ORDER BY COALESCE(sm.bill_date, vm.voucher_date) ASC, vm.voucher_posted_id ASC`;

/** First source wins — voucher rows before sales (avoids double-count / inflated MAX). */
function mergeOutstandingBills(...groups) {
  const map = new Map();
  for (const b of groups.flat()) {
    if (b.billId == null) continue;
    const due = num(b.currentAmount);
    const pdc = num(b.pdcPending);
    if (due <= 0.005 && pdc <= 0.005) continue;
    if (!map.has(b.billId)) {
      map.set(b.billId, {
        ...b,
        currentAmount: due,
        pdcPending: pdc,
        clearedPaid: num(b.clearedPaid),
      });
    }
  }
  return [...map.values()].sort((a, b) => {
    const da = a.billDate ? new Date(a.billDate).getTime() : 0;
    const db = b.billDate ? new Date(b.billDate).getTime() : 0;
    if (da !== db) return da - db;
    return a.billId - b.billId;
  });
}

/** Credit customer — any open sale with balance due (not only payment_mode = CREDIT on the bill). */
const CREDIT_CUSTOMER_SALES_SQL = `
  SELECT
    sm.sales_id AS bill_id,
    sm.bill_no,
    sm.bill_date,
    sm.amount::numeric AS invoice_amount,
    ${BASE_DUE_EXPR} AS current_amount,
    ${PDC_PAID_SUBQUERY} AS pdc_pending,
    ${CLEARED_PAID_SUBQUERY} AS cleared_paid,
    TRIM(COALESCE(sm.prefix, 'B-') || sm.bill_no::text) AS invoice_no
  FROM ops.sales_master sm
  INNER JOIN biz.customer_master cm
    ON cm.company_id = sm.company_id
   AND cm.customer_id = sm.customer_id
  WHERE sm.company_id = $1
    AND sm.customer_id = $2
    AND UPPER(TRIM(COALESCE(cm.payment_mode, ''))) IN ('CREDIT', 'CREDITCARD')
    AND sm.amount > 0
    AND COALESCE(UPPER(sm.transaction_type), 'SALE') NOT IN ('RETURN', 'REFUND')
    AND COALESCE(UPPER(sm.hold_status), '') NOT IN ('HOLD', 'HELD')
    ${POSTED_SALE_STATUS_SQL}
    AND (${BASE_DUE_EXPR} > 0.005 OR ${PDC_PAID_SUBQUERY} > 0.005)
  ORDER BY sm.bill_date ASC, sm.sales_id ASC`;

const ORPHAN_CLEARED_PAID_SUBQUERY = `COALESCE((
        SELECT SUM(ctc.paid_amount)::numeric
        FROM accounts.cash_transaction_child ctc
        WHERE ctc.company_id = vd.company_id
          AND ctc.bill_id = (-vm.voucher_master_id)::bigint
      ), 0)`;
const ORPHAN_LINE_DUE_EXPR = debitBillOsExpr(ORPHAN_CLEARED_PAID_SUBQUERY);

/** DR lines on customer ledger not linked to a posted sale (opening balance, journals, etc.). */
const VOUCHER_ORPHAN_OUTSTANDING_SQL = `
  SELECT
    (-vm.voucher_master_id)::bigint AS bill_id,
    vm.voucher_master_id AS bill_no,
    vm.voucher_date AS bill_date,
    vd.debit_amount::numeric AS invoice_amount,
    ${ORPHAN_LINE_DUE_EXPR} AS current_amount,
    TRIM(COALESCE(vm.voucher_prefix, 'JV-') || vm.manual_voucher_no::text) AS invoice_no
  FROM accounts.voucher_detail vd
  INNER JOIN accounts.voucher_master vm
    ON vm.company_id = vd.company_id
   AND vm.voucher_master_id = vd.voucher_master_id
  INNER JOIN biz.customer_master cm
    ON cm.company_id = $1
   AND cm.customer_id = $2
  INNER JOIN accounts.account_head_master ah
    ON ah.company_id = cm.company_id
   AND ah.account_no = cm.customer_code
   AND (ah.record_status IS NULL OR TRIM(UPPER(ah.record_status)) = 'ACTIVE')
  WHERE vd.company_id = $1
    AND vd.account_id = ah.account_id
    AND vd.debit_amount > 0
    AND COALESCE(vm.voucher_posted_id, 0) = 0
    AND (vd.record_status IS NULL OR TRIM(UPPER(vd.record_status)) = 'ACTIVE')
    ${POSTED_VOUCHER_STATUS_SQL}
    AND ${ORPHAN_LINE_DUE_EXPR} > 0.005
  ORDER BY vm.voucher_date ASC, vm.voucher_master_id ASC`;

/**
 * Return open posted bill lines only — no synthetic "Opening / Other" row.
 * Receipt / payment must allocate against real posted bills, not ledger gaps
 * caused by unposted sales still sitting on the account.
 */
export function reconcilePostedBills(bills) {
  return bills
    .filter((b) => num(b.currentAmount) > 0.005)
    .map((b) => ({ ...b, currentAmount: num(b.currentAmount) }));
}

/**
 * Align open bill lines with ledger O/S (Tally-style).
 * - Ledger 0 → no open bills
 * - Ledger > bill sum → add Opening / Other
 * - Ledger < bill sum → trim newest bills until sums match
 */
export function reconcileBillsWithLedger(bills, ledgerOs, customerId) {
  const target = num(ledgerOs);
  if (target <= 0.005) return [];

  let reconciled = bills
    .filter(b => b.currentAmount > 0.005)
    .map(b => ({ ...b, currentAmount: num(b.currentAmount) }));

  let sum = reconciled.reduce((s, b) => s + num(b.currentAmount), 0);
  let diff = parseFloat((target - sum).toFixed(3));

  if (diff > 0.005) {
    reconciled.unshift({
      billId:        -Math.abs(Number(customerId) || 1),
      billNo:        0,
      billDate:      null,
      invoiceNo:     'Opening / Other',
      invoiceAmount: diff,
      currentAmount: diff,
      isReconcile:   true,
    });
    return reconciled;
  }

  if (diff < -0.005) {
    let excess = -diff;
    for (let i = reconciled.length - 1; i >= 0 && excess > 0.005; i -= 1) {
      const cur = num(reconciled[i].currentAmount);
      const take = Math.min(excess, cur);
      const next = parseFloat((cur - take).toFixed(3));
      reconciled[i] = { ...reconciled[i], currentAmount: next };
      excess = parseFloat((excess - take).toFixed(3));
    }
    reconciled = reconciled.filter(b => b.currentAmount > 0.005);
  }

  return reconciled;
}

async function querySalesBills(db, companyId, customerId) {
  try {
    const { rows } = await db.query(SALES_OUTSTANDING_SQL, [companyId, customerId]);
    return rows.map(mapBillRow);
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return trySalesBillsLegacy(db, companyId, customerId);
    throw e;
  }
}

/** Older DBs without outstanding_balance / credit_amount columns. */
async function trySalesBillsLegacy(db, companyId, customerId) {
  const sql = `
    SELECT
      sm.sales_id AS bill_id,
      sm.bill_no,
      sm.bill_date,
      sm.amount::numeric AS invoice_amount,
      GREATEST(
        sm.amount::numeric - COALESCE((
          SELECT SUM(ctc.paid_amount)::numeric
          FROM accounts.cash_transaction_child ctc
          WHERE ctc.company_id = sm.company_id AND ctc.bill_id = sm.sales_id
        ), 0),
        0
      ) AS current_amount,
      TRIM(COALESCE(sm.bill_no, sm.sales_id)::text) AS invoice_no
    FROM ops.sales_master sm
    WHERE sm.company_id = $1
      AND sm.customer_id = $2
      AND sm.amount > 0
      AND UPPER(TRIM(COALESCE(sm.payment_mode, ''))) = 'CREDIT'
      AND UPPER(COALESCE(sm.post_status, 'PENDING')) = 'POSTED'
      AND GREATEST(
        sm.amount::numeric - COALESCE((
          SELECT SUM(ctc.paid_amount)::numeric
          FROM accounts.cash_transaction_child ctc
          WHERE ctc.company_id = sm.company_id AND ctc.bill_id = sm.sales_id
        ), 0),
        0
      ) > 0.005
    ORDER BY sm.bill_date ASC, sm.sales_id ASC`;
  try {
    const { rows } = await db.query(sql, [companyId, customerId]);
    return rows.map(mapBillRow);
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return [];
    throw e;
  }
}

async function queryVoucherBills(db, companyId, customerId) {
  try {
    const { rows } = await db.query(VOUCHER_OUTSTANDING_SQL, [companyId, customerId]);
    return rows.map(mapBillRow);
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return [];
    throw e;
  }
}

async function queryCreditCustomerSales(db, companyId, customerId) {
  try {
    const { rows } = await db.query(CREDIT_CUSTOMER_SALES_SQL, [companyId, customerId]);
    return rows.map(mapBillRow);
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return [];
    throw e;
  }
}

async function queryOrphanVoucherBills(db, companyId, customerId) {
  try {
    const { rows } = await db.query(VOUCHER_ORPHAN_OUTSTANDING_SQL, [companyId, customerId]);
    return rows.map(mapBillRow);
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return [];
    throw e;
  }
}

export async function repairNonCreditSalesOutstanding(db, companyId, customerId) {
  try {
    await db.query(
      `UPDATE ops.sales_master
       SET outstanding_balance = 0, modified_at = NOW()
       WHERE company_id = $1
         AND customer_id = $2
         AND COALESCE(outstanding_balance, 0) > 0.005
         AND NOT (
           UPPER(TRIM(COALESCE(payment_mode, ''))) = 'CREDIT'
           OR (
             UPPER(TRIM(COALESCE(payment_mode, ''))) IN ('MULTIPAYMENT', 'MULTIPAY')
             AND COALESCE(credit_amount, 0) > 0.005
           )
         )`,
      [companyId, customerId],
    );
  } catch (e) {
    if (e.code !== '42703') throw e;
  }
}

/** When ledger is fully cleared, zero per-bill / voucher O/S fields for this customer. */
export async function syncCustomerCreditState(client, companyId, customerId, customerLedgerId) {
  try {
    await client.query(
      `UPDATE ops.sales_master
       SET outstanding_balance = 0, modified_at = NOW()
       WHERE company_id = $1
         AND customer_id = $2
         AND COALESCE(outstanding_balance, 0) > 0.005`,
      [companyId, customerId],
    );
  } catch (e) {
    if (e.code !== '42703') throw e;
  }

  if (!customerLedgerId) return;

  try {
    await client.query(
      `UPDATE accounts.voucher_detail vd
       SET outstanding_balance = 0, modified_at = NOW()
       FROM accounts.voucher_master vm
       WHERE vd.company_id = $1
         AND vd.account_id = $2
         AND vd.voucher_master_id = vm.voucher_master_id
         AND vm.company_id = $1
         AND vd.debit_amount > 0
         AND COALESCE(vd.outstanding_balance, 0) > 0.005`,
      [companyId, customerLedgerId],
    );
  } catch (e) {
    if (e.code !== '42P01' && e.code !== '42703') throw e;
  }
}

/** Reject receipt/payment allocation against unposted bills. */
export async function assertPostedBillAllocations(db, companyId, allocations) {
  for (const a of allocations) {
    const billId = Number(a.billId);
    if (!Number.isFinite(billId) || a.isReconcile) continue;

    if (billId > 0) {
      const { rows: saleRows } = await db.query(
        `SELECT sm.sales_id
         FROM ops.sales_master sm
         WHERE sm.company_id = $1 AND sm.sales_id = $2
           AND UPPER(COALESCE(sm.post_status, 'PENDING')) = 'POSTED'
         LIMIT 1`,
        [companyId, billId],
      );
      if (!saleRows[0]) {
        const err = new Error(
          `Bill ${a.invoiceNo || billId} is not posted — post the sale before receiving payment`,
        );
        err.status = 400;
        throw err;
      }
      continue;
    }

    const voucherMasterId = Math.abs(billId);
    const { rows } = await db.query(
      `SELECT voucher_master_id
       FROM accounts.voucher_master
       WHERE company_id = $1 AND voucher_master_id = $2
         AND UPPER(COALESCE(post_status, 'PENDING')) = 'POSTED'
       LIMIT 1`,
      [companyId, voucherMasterId],
    );
    if (!rows[0]) {
      const err = new Error(
        `Voucher ${a.invoiceNo || voucherMasterId} is not posted — post before receiving payment`,
      );
      err.status = 400;
      throw err;
    }
  }
}

export async function getOutstandingBills(db, companyId, customerId) {
  await repairNonCreditSalesOutstanding(db, companyId, customerId);

  const [voucherBills, orphanBills, salesBills] = await Promise.all([
    queryVoucherBills(db, companyId, customerId),
    queryOrphanVoucherBills(db, companyId, customerId),
    querySalesBills(db, companyId, customerId),
  ]);
  return mergeOutstandingBills(voucherBills, orphanBills, salesBills);
}

/**
 * Map of customer_id → open credit sales O/S (sales_master), for settlement lists.
 * Includes Counter-POS and Salon-POS credit bills so customers appear even when
 * the ledger voucher is missing / lagging.
 */
export async function sumOpenCreditSalesOsByCustomer(db, companyId, { q = '', limit = 200 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const params = [companyId];
  let searchSql = '';
  if (String(q || '').trim()) {
    params.push(`%${String(q).trim()}%`);
    searchSql = `AND (
      cm.customer_code ILIKE $2
      OR cm.customer_name ILIKE $2
      OR COALESCE(cm.mobile_no, '') ILIKE $2
    )`;
  }
  params.push(cap);
  const limIdx = params.length;

  const { rows } = await db.query(
    `SELECT sm.customer_id,
            COALESCE(SUM(
              GREATEST(
                COALESCE(
                  NULLIF(sm.outstanding_balance::numeric, 0),
                  NULLIF(sm.credit_amount::numeric, 0),
                  CASE
                    WHEN UPPER(TRIM(COALESCE(sm.payment_mode, ''))) = 'CREDIT'
                    THEN sm.amount::numeric
                    ELSE 0
                  END
                ),
                0
              )
            ), 0)::numeric AS sales_os
       FROM ops.sales_master sm
       INNER JOIN biz.customer_master cm
         ON cm.company_id = sm.company_id
        AND cm.customer_id = sm.customer_id
      WHERE sm.company_id = $1
        AND sm.customer_id IS NOT NULL
        AND sm.amount > 0
        AND (
          UPPER(TRIM(COALESCE(sm.payment_mode, ''))) = 'CREDIT'
          OR (
            UPPER(TRIM(COALESCE(sm.payment_mode, ''))) IN ('MULTIPAYMENT', 'MULTIPAY')
            AND COALESCE(sm.credit_amount, 0) > 0.005
          )
        )
        AND COALESCE(UPPER(sm.transaction_type), 'SALE') NOT IN ('RETURN', 'REFUND')
        AND COALESCE(UPPER(sm.hold_status), '') NOT IN ('HOLD', 'HELD', 'DELIVERY')
        AND UPPER(COALESCE(sm.post_status, 'PENDING')) = 'POSTED'
        AND COALESCE(
              NULLIF(sm.outstanding_balance::numeric, 0),
              NULLIF(sm.credit_amount::numeric, 0),
              CASE
                WHEN UPPER(TRIM(COALESCE(sm.payment_mode, ''))) = 'CREDIT'
                THEN sm.amount::numeric
                ELSE 0
              END,
              0
            ) > 0.005
        ${searchSql}
      GROUP BY sm.customer_id
      HAVING COALESCE(SUM(
               GREATEST(
                 COALESCE(
                   NULLIF(sm.outstanding_balance::numeric, 0),
                   NULLIF(sm.credit_amount::numeric, 0),
                   CASE
                     WHEN UPPER(TRIM(COALESCE(sm.payment_mode, ''))) = 'CREDIT'
                     THEN sm.amount::numeric
                     ELSE 0
                   END
                 ),
                 0
               )
             ), 0) > 0.005
      ORDER BY sales_os DESC
      LIMIT $${limIdx}`,
    params,
  );

  const map = new Map();
  for (const r of rows) {
    map.set(Number(r.customer_id), num(r.sales_os));
  }
  return map;
}

export async function getCustomerById(db, companyId, customerId) {
  const { rows } = await db.query(
    `SELECT customer_id, customer_code, customer_name, payment_mode, credit_balance
     FROM biz.customer_master
     WHERE company_id = $1 AND customer_id = $2
       AND (status IS NULL OR status = 'ACTIVE')
     LIMIT 1`,
    [companyId, customerId],
  );
  return rows[0] ?? null;
}

export async function nextTransactionId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(transaction_id), 0) + 1 AS n
     FROM accounts.cash_transaction_master
     WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].n);
}

export async function nextTransactionNo(client, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(transaction_no), 0) + 1 AS n
     FROM accounts.cash_transaction_master
     WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId],
  );
  return Number(rows[0].n);
}

export async function nextTransactionChildIdBase(client, companyId, count) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(transaction_child_id), 0) + 1 AS base
     FROM accounts.cash_transaction_child
     WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].base);
}

export async function insertCashTransactionMaster(client, row) {
  const postDatedCheque = Boolean(row.postDatedCheque);
  const status = row.status || (postDatedCheque ? 'PDC_PENDING' : 'ACTIVE');
  const chequeDetails = row.chequeDetails ?? null;
  const chequeDate = row.chequeDate ?? null;
  const baseParams = [
    row.companyId, row.branchId, row.transactionId, row.transactionNo, row.transactionDate ?? new Date(),
    row.counterNo ?? null, row.customerId, row.amount, row.transactionType ?? 'CUSTOMER RECEIPT',
    row.totalCurrentAmount, row.totalPaidAmount,
    row.remarks ?? null, row.paymentMode, row.voucherMasterId ?? null,
    row.createdBy,
  ];
  try {
    await client.query(
      `INSERT INTO accounts.cash_transaction_master (
         company_id, branch_id, transaction_id, transaction_no, transaction_date,
         counter_no, customer_id, amount, transaction_type,
         post_dated_cheque, cheque_details, cheque_date,
         total_current_amount, total_paid_amount,
         remarks, status, payment_mode, voucher_master_id,
         created_by, modified_by, counter_close_status
       ) VALUES (
         $1,$2,$3,$4,$5,
         $6,$7,$8,$9,
         $16,$17,$18,
         $10,$11,
         $12,$19,$13,$14,
         $15,$15,'PENDING'
       )`,
      [...baseParams, postDatedCheque, chequeDetails, chequeDate, status],
    );
  } catch (e) {
    if (e.code !== '42703') throw e;
    await client.query(
      `INSERT INTO accounts.cash_transaction_master (
         company_id, branch_id, transaction_id, transaction_no, transaction_date,
         counter_no, customer_id, amount, transaction_type,
         post_dated_cheque, total_current_amount, total_paid_amount,
         remarks, status, payment_mode, voucher_master_id,
         created_by, modified_by
       ) VALUES (
         $1,$2,$3,$4,$5,
         $6,$7,$8,$9,
         $16,$10,$11,
         $12,$17,$13,$14,
         $15,$15
       )`,
      [...baseParams, postDatedCheque, status],
    );
  }
}

export async function insertCashTransactionChild(client, row) {
  await client.query(
    `INSERT INTO accounts.cash_transaction_child (
       company_id, branch_id, transaction_child_id, transaction_id,
       bill_id, bill_date, invoice_no, invoice_amount,
       current_amount, paid_amount, balance, ledger_id,
       created_by, modified_by
     ) VALUES (
       $1,$2,$3,$4,
       $5,$6,$7,$8,
       $9,$10,$11,$12,
       $13,$13
     )`,
    [
      row.companyId, row.branchId, row.transactionChildId, row.transactionId,
      row.billId, row.billDate, row.invoiceNo, row.invoiceAmount,
      row.currentAmount, row.paidAmount, row.balance, row.ledgerId,
      row.createdBy,
    ],
  );
}

export async function updateSalesOutstanding(client, companyId, salesId, outstandingBalance) {
  try {
    await client.query(
      `UPDATE ops.sales_master
       SET outstanding_balance = $3, modified_at = NOW()
       WHERE company_id = $1 AND sales_id = $2`,
      [companyId, salesId, outstandingBalance],
    );
  } catch (e) {
    if (e.code !== '42703') throw e;
  }
}

function parseOsAfterFromRemarks(remarks) {
  const m = String(remarks || '').match(/\|OSA:([0-9.]+)/);
  return m ? num(m[1]) : null;
}

function buildReceiptNo(transactionNo, transactionId) {
  const n = Number(transactionNo) || Number(transactionId) || 0;
  return `RCV-${n}`;
}

export async function listSettlementHistory(db, companyId, branchId, filters = {}) {
  const params = [companyId, branchId];
  let where = `
    ctm.company_id = $1
    AND ctm.branch_id = $2
    AND UPPER(COALESCE(ctm.status, 'ACTIVE')) = 'ACTIVE'
    AND UPPER(COALESCE(ctm.transaction_type, '')) IN ('CUSTOMER RECEIPT', 'CUSTOMER_RECEIPT', 'RECEIPT')
  `;

  if (filters.customerId) {
    params.push(Number(filters.customerId));
    where += ` AND ctm.customer_id = $${params.length}`;
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    where += ` AND ctm.transaction_date >= $${params.length}::date`;
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    where += ` AND ctm.transaction_date < ($${params.length}::date + interval '1 day')`;
  }

  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 200);
  params.push(limit);

  try {
    const { rows } = await db.query(
      `SELECT
         ctm.transaction_id,
         ctm.transaction_no,
         ctm.transaction_date,
         ctm.customer_id,
         cm.customer_code,
         cm.customer_name,
         ctm.amount,
         ctm.payment_mode,
         ctm.total_current_amount,
         ctm.total_paid_amount,
         ctm.voucher_master_id,
         ctm.remarks,
         ctm.counter_no,
         ctm.created_by,
         (SELECT COUNT(*)::int FROM accounts.cash_transaction_child ctc
          WHERE ctc.company_id = ctm.company_id AND ctc.transaction_id = ctm.transaction_id) AS bill_count
       FROM accounts.cash_transaction_master ctm
       LEFT JOIN biz.customer_master cm
         ON cm.company_id = ctm.company_id AND cm.customer_id = ctm.customer_id
       WHERE ${where}
       ORDER BY ctm.transaction_date DESC, ctm.transaction_id DESC
       LIMIT $${params.length}`,
      params,
    );

    return rows.map(r => {
      const osBefore = num(r.total_current_amount);
      const paid = num(r.amount);
      const osAfter = parseOsAfterFromRemarks(r.remarks) ?? Math.max(osBefore - paid, 0);
      return {
        transactionId:   Number(r.transaction_id),
        transactionNo: Number(r.transaction_no),
        receiptNo:     buildReceiptNo(r.transaction_no, r.transaction_id),
        transactionDate: r.transaction_date,
        customerId:    r.customer_id != null ? Number(r.customer_id) : null,
        customerCode:  r.customer_code ?? null,
        customerName:  r.customer_name ?? '—',
        paidAmount:    paid,
        paymentMode:   r.payment_mode ?? 'CASH',
        osBefore,
        osAfter,
        voucherMasterId: r.voucher_master_id != null ? Number(r.voucher_master_id) : null,
        counterNo:     r.counter_no != null ? Number(r.counter_no) : null,
        createdBy:     r.created_by ?? null,
        billCount:     Number(r.bill_count) || 0,
      };
    });
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return [];
    throw e;
  }
}

export async function getSettlementReceipt(db, companyId, branchId, transactionId) {
  const tid = Number(transactionId);
  try {
    const { rows: masters } = await db.query(
      `SELECT
         ctm.*,
         cm.customer_code,
         cm.customer_name
       FROM accounts.cash_transaction_master ctm
       LEFT JOIN biz.customer_master cm
         ON cm.company_id = ctm.company_id AND cm.customer_id = ctm.customer_id
       WHERE ctm.company_id = $1
         AND ctm.branch_id = $2
         AND ctm.transaction_id = $3
       LIMIT 1`,
      [companyId, branchId, tid],
    );
    if (!masters.length) return null;

    const m = masters[0];
    const { rows: children } = await db.query(
      `SELECT
         transaction_child_id, bill_id, bill_date, invoice_no,
         invoice_amount, current_amount, paid_amount, balance, ledger_id
       FROM accounts.cash_transaction_child
       WHERE company_id = $1 AND transaction_id = $2
       ORDER BY bill_date ASC, bill_id ASC`,
      [companyId, tid],
    );

    let voucher = null;
    if (m.voucher_master_id != null) {
      try {
        const { rows: vRows } = await db.query(
          `SELECT voucher_master_id, voucher_prefix, auto_voucher_no, manual_voucher_no,
                  voucher_date, voucher_amount, reference_no, remarks, post_status
           FROM accounts.voucher_master
           WHERE company_id = $1 AND voucher_master_id = $2
           LIMIT 1`,
          [companyId, m.voucher_master_id],
        );
        if (vRows[0]) {
          voucher = {
            voucherMasterId: Number(vRows[0].voucher_master_id),
            voucherPrefix:   vRows[0].voucher_prefix ?? '',
            autoVoucherNo:   Number(vRows[0].auto_voucher_no),
            manualVoucherNo: vRows[0].manual_voucher_no ?? null,
            voucherDate:     vRows[0].voucher_date,
            voucherAmount:   num(vRows[0].voucher_amount),
            referenceNo:     vRows[0].reference_no ?? null,
            remarks:         vRows[0].remarks ?? null,
            postStatus:      vRows[0].post_status ?? null,
          };
        }
      } catch (e) {
        if (e.code !== '42P01' && e.code !== '42703') throw e;
      }
    }

    const osBefore = num(m.total_current_amount);
    const paid = num(m.amount);
    const osAfter = parseOsAfterFromRemarks(m.remarks) ?? Math.max(osBefore - paid, 0);

    return {
      transactionId:   tid,
      transactionNo: Number(m.transaction_no),
      receiptNo:     buildReceiptNo(m.transaction_no, tid),
      transactionDate: m.transaction_date,
      customerId:    m.customer_id != null ? Number(m.customer_id) : null,
      customerCode:  m.customer_code ?? null,
      customerName:  m.customer_name ?? '—',
      paidAmount:    paid,
      paymentMode:   m.payment_mode ?? 'CASH',
      postDatedCheque: Boolean(m.post_dated_cheque) || String(m.payment_mode || '').toUpperCase() === 'CHEQUE',
      chequeDetails: m.cheque_details ?? null,
      chequeDate: m.cheque_date ?? null,
      status: m.status ?? 'ACTIVE',
      osBefore,
      osAfter,
      counterNo:     m.counter_no != null ? Number(m.counter_no) : null,
      createdBy:     m.created_by ?? null,
      remarks:       m.remarks ?? null,
      voucher,
      clearedBills: children.map(c => ({
        transactionChildId: Number(c.transaction_child_id),
        billId:         Number(c.bill_id),
        billDate:       c.bill_date,
        invoiceNo:      c.invoice_no ?? `B-${c.bill_id}`,
        invoiceAmount:  num(c.invoice_amount),
        osBefore:       num(c.current_amount),
        paidAmount:     num(c.paid_amount),
        osAfter:        num(c.balance),
        ledgerId:       Number(c.ledger_id),
      })),
    };
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return null;
    throw e;
  }
}

export async function reduceSaleVoucherOutstanding(client, companyId, salesId, customerLedgerId, reduceBy) {
  try {
    await client.query(
      `UPDATE accounts.voucher_detail vd
       SET outstanding_balance = GREATEST(
             COALESCE(vd.outstanding_balance, vd.debit_amount, 0) - $4,
             0
           ),
           modified_at = NOW()
       FROM accounts.voucher_master vm
       WHERE vd.company_id = $1
         AND vd.voucher_master_id = vm.voucher_master_id
         AND vm.company_id = $1
         AND vm.voucher_posted_id = $2
         AND vd.account_id = $3
         AND vd.debit_amount > 0`,
      [companyId, salesId, customerLedgerId, reduceBy],
    );
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return;
    throw e;
  }
}

/** Reduce orphan / opening DR lines (negative bill_id = -voucher_master_id). */
export async function reduceOrphanVoucherOutstanding(client, companyId, billId, customerLedgerId, reduceBy) {
  const voucherMasterId = Math.abs(Number(billId));
  if (!Number.isFinite(voucherMasterId) || voucherMasterId < 1) return;

  let remaining = num(reduceBy);
  try {
    const { rows } = await client.query(
      `SELECT vd.voucher_detail_id,
              ${VD_DEBIT_LINE_OS_EXPR}::numeric AS os
       FROM accounts.voucher_detail vd
       INNER JOIN accounts.voucher_master vm
         ON vm.company_id = vd.company_id
        AND vm.voucher_master_id = vd.voucher_master_id
       WHERE vd.company_id = $1
         AND vd.account_id = $2
         AND vd.debit_amount > 0
         AND COALESCE(vm.voucher_posted_id, 0) = 0
         AND (vd.record_status IS NULL OR TRIM(UPPER(vd.record_status)) = 'ACTIVE')
         AND ${VD_DEBIT_LINE_OS_EXPR} > 0.005
       ORDER BY vm.voucher_date ASC, vm.voucher_master_id ASC`,
      [companyId, customerLedgerId],
    );

    for (const row of rows) {
      if (remaining <= 0.005) break;
      const take = Math.min(remaining, num(row.os));
      if (take <= 0.005) continue;
      await client.query(
        `UPDATE accounts.voucher_detail
         SET outstanding_balance = GREATEST(COALESCE(outstanding_balance, 0) - $3, 0),
             modified_at = NOW()
         WHERE company_id = $1 AND voucher_detail_id = $2`,
        [companyId, row.voucher_detail_id, take],
      );
      remaining = parseFloat((remaining - take).toFixed(3));
    }

    if (remaining > 0.005 && billId < 0) {
      await client.query(
        `UPDATE accounts.voucher_detail vd
         SET outstanding_balance = GREATEST(COALESCE(vd.outstanding_balance, vd.debit_amount, 0) - $4, 0),
             modified_at = NOW()
         FROM accounts.voucher_master vm
         WHERE vd.company_id = $1
           AND vd.voucher_master_id = vm.voucher_master_id
           AND vm.company_id = $1
           AND vm.voucher_master_id = $3
           AND vd.account_id = $2
           AND vd.debit_amount > 0`,
        [companyId, customerLedgerId, voucherMasterId, remaining],
      );
    }
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return;
    throw e;
  }
}

export async function getCashTransactionByVoucherMasterId(db, companyId, voucherMasterId) {
  try {
    const { rows } = await db.query(
      `SELECT ctm.*, cm.customer_code, cm.customer_name
       FROM accounts.cash_transaction_master ctm
       LEFT JOIN biz.customer_master cm
         ON cm.company_id = ctm.company_id AND cm.customer_id = ctm.customer_id
       WHERE ctm.company_id = $1 AND ctm.voucher_master_id = $2
       LIMIT 1`,
      [companyId, Number(voucherMasterId)],
    );
    return rows[0] || null;
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return null;
    throw e;
  }
}

export async function deleteCashTransactionChildren(client, companyId, transactionId) {
  await client.query(
    `DELETE FROM accounts.cash_transaction_child
     WHERE company_id = $1 AND transaction_id = $2`,
    [companyId, Number(transactionId)],
  );
}

export async function updateCashTransactionChildBalances(client, companyId, transactionId, allocations) {
  for (const a of allocations) {
    await client.query(
      `UPDATE accounts.cash_transaction_child
       SET balance = $4, modified_at = NOW()
       WHERE company_id = $1 AND transaction_id = $2 AND bill_id = $3`,
      [companyId, Number(transactionId), a.billId, a.balance],
    );
  }
}

export async function updateCashTransactionMaster(client, companyId, branchId, transactionId, fields = {}) {
  await client.query(
    `UPDATE accounts.cash_transaction_master
     SET amount = COALESCE($4, amount),
         total_paid_amount = COALESCE($4, total_paid_amount),
         total_current_amount = COALESCE($5, total_current_amount),
         transaction_date = COALESCE($6, transaction_date),
         remarks = COALESCE($7, remarks),
         payment_mode = COALESCE($8, payment_mode),
         post_dated_cheque = COALESCE($9, post_dated_cheque),
         cheque_details = COALESCE($10, cheque_details),
         cheque_date = COALESCE($11, cheque_date),
         status = COALESCE($12, status),
         modified_at = NOW()
     WHERE company_id = $1 AND branch_id = $2 AND transaction_id = $3`,
    [
      companyId,
      branchId,
      Number(transactionId),
      fields.amount ?? null,
      fields.totalCurrentAmount ?? null,
      fields.transactionDate ?? null,
      fields.remarks ?? null,
      fields.paymentMode ?? null,
      fields.postDatedCheque ?? null,
      fields.chequeDetails ?? null,
      fields.chequeDate ?? null,
      fields.status ?? null,
    ],
  );
}

export async function getSalesOutstandingBalance(client, companyId, salesId) {
  try {
    const { rows } = await client.query(
      `SELECT outstanding_balance FROM ops.sales_master
       WHERE company_id = $1 AND sales_id = $2 LIMIT 1`,
      [companyId, salesId],
    );
    return num(rows[0]?.outstanding_balance);
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return 0;
    throw e;
  }
}

export async function restoreSaleVoucherOutstanding(client, companyId, salesId, customerLedgerId, restoreBy) {
  try {
    await client.query(
      `UPDATE accounts.voucher_detail vd
       SET outstanding_balance = LEAST(
             COALESCE(vd.debit_amount, 0),
             COALESCE(vd.outstanding_balance, vd.debit_amount, 0) + $4
           ),
           modified_at = NOW()
       FROM accounts.voucher_master vm
       WHERE vd.company_id = $1
         AND vd.voucher_master_id = vm.voucher_master_id
         AND vm.company_id = $1
         AND vm.voucher_posted_id = $2
         AND vd.account_id = $3
         AND vd.debit_amount > 0`,
      [companyId, salesId, customerLedgerId, restoreBy],
    );
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return;
    throw e;
  }
}

export async function restoreOrphanVoucherOutstanding(client, companyId, billId, customerLedgerId, restoreBy) {
  const voucherMasterId = Math.abs(Number(billId));
  if (!Number.isFinite(voucherMasterId) || voucherMasterId < 1) return;
  try {
    await client.query(
      `UPDATE accounts.voucher_detail vd
       SET outstanding_balance = COALESCE(vd.outstanding_balance, 0) + $4,
           modified_at = NOW()
       FROM accounts.voucher_master vm
       WHERE vd.company_id = $1
         AND vd.voucher_master_id = vm.voucher_master_id
         AND vm.company_id = $1
         AND vm.voucher_master_id = $3
         AND vd.account_id = $2
         AND vd.debit_amount > 0`,
      [companyId, customerLedgerId, voucherMasterId, restoreBy],
    );
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return;
    throw e;
  }
}
