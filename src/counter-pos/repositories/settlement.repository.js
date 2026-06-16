/**
 * Credit settlement — outstanding bills + cash_transaction_master/child.
 */

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
  };
}

/** Amount still due on a bill after prior settlement lines. */
const PAID_SUBQUERY = `
  COALESCE((
    SELECT SUM(ctc.paid_amount)::numeric
    FROM accounts.cash_transaction_child ctc
    WHERE ctc.company_id = sm.company_id
      AND ctc.bill_id = sm.sales_id
  ), 0)`;

const BASE_DUE_EXPR = `
  GREATEST(
    COALESCE(
      NULLIF(sm.outstanding_balance::numeric, 0),
      NULLIF(sm.credit_amount::numeric, 0),
      sm.amount::numeric
    ) - ${PAID_SUBQUERY},
    0
  )`;

/** Open credit sales for a customer (broad match — not only payment_mode = CREDIT). */
const SALES_OUTSTANDING_SQL = `
  SELECT
    sm.sales_id AS bill_id,
    sm.bill_no,
    sm.bill_date,
    sm.amount::numeric AS invoice_amount,
    ${BASE_DUE_EXPR} AS current_amount,
    TRIM(COALESCE(sm.prefix, 'B-') || sm.bill_no::text) AS invoice_no
  FROM ops.sales_master sm
  WHERE sm.company_id = $1
    AND sm.customer_id = $2
    AND sm.amount > 0
    AND COALESCE(UPPER(sm.transaction_type), 'SALE') NOT IN ('RETURN', 'REFUND')
    AND COALESCE(UPPER(sm.hold_status), '') NOT IN ('HOLD', 'HELD')
    AND COALESCE(UPPER(sm.post_status), 'POSTED') NOT IN ('CANCELLED', 'VOID', 'CANCELED')
    AND (
      UPPER(TRIM(COALESCE(sm.payment_mode, ''))) IN ('CREDIT', 'CREDITCARD')
      OR COALESCE(sm.credit_amount, 0) > 0
      OR COALESCE(sm.outstanding_balance, 0) > 0.005
      OR EXISTS (
        SELECT 1
        FROM accounts.voucher_master vm
        INNER JOIN accounts.voucher_detail vd
          ON vd.company_id = vm.company_id
         AND vd.voucher_master_id = vm.voucher_master_id
        INNER JOIN biz.customer_master cm2
          ON cm2.company_id = sm.company_id
         AND cm2.customer_id = sm.customer_id
        INNER JOIN accounts.account_head_master ah2
          ON ah2.company_id = cm2.company_id
         AND ah2.account_no = cm2.customer_code
        WHERE vm.company_id = sm.company_id
          AND vm.voucher_posted_id = sm.sales_id
          AND vd.account_id = ah2.account_id
          AND vd.debit_amount > 0
          AND COALESCE(vd.outstanding_balance, 0) > 0.005
      )
    )
    AND ${BASE_DUE_EXPR} > 0.005
  ORDER BY sm.bill_date ASC, sm.sales_id ASC`;

/** Fallback: open DR lines on customer ledger linked to posted sales vouchers. */
const VOUCHER_OUTSTANDING_SQL = `
  SELECT
    vm.voucher_posted_id AS bill_id,
    COALESCE(sm.bill_no, vm.voucher_posted_id) AS bill_no,
    COALESCE(sm.bill_date, vm.voucher_date) AS bill_date,
    COALESCE(sm.amount, vm.voucher_amount)::numeric AS invoice_amount,
    GREATEST(
      COALESCE(NULLIF(vd.outstanding_balance, 0), vd.debit_amount, 0)::numeric
      - COALESCE((
        SELECT SUM(ctc.paid_amount)::numeric
        FROM accounts.cash_transaction_child ctc
        WHERE ctc.company_id = vd.company_id
          AND ctc.bill_id = vm.voucher_posted_id
      ), 0),
      0
    ) AS current_amount,
    TRIM(COALESCE(sm.prefix, 'B-') || COALESCE(sm.bill_no, vm.voucher_posted_id)::text) AS invoice_no
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
    AND GREATEST(
      COALESCE(NULLIF(vd.outstanding_balance, 0), vd.debit_amount, 0)::numeric
      - COALESCE((
        SELECT SUM(ctc.paid_amount)::numeric
        FROM accounts.cash_transaction_child ctc
        WHERE ctc.company_id = vd.company_id
          AND ctc.bill_id = vm.voucher_posted_id
      ), 0),
      0
    ) > 0.005
  ORDER BY COALESCE(sm.bill_date, vm.voucher_date) ASC, vm.voucher_posted_id ASC`;

function mergeOutstandingBills(...groups) {
  const map = new Map();
  for (const b of groups.flat()) {
    if (b.billId == null || b.currentAmount <= 0.005) continue;
    const prev = map.get(b.billId);
    if (!prev || b.currentAmount > prev.currentAmount) {
      map.set(b.billId, b);
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
    AND COALESCE(UPPER(sm.post_status), 'POSTED') NOT IN ('CANCELLED', 'VOID', 'CANCELED')
    AND ${BASE_DUE_EXPR} > 0.005
  ORDER BY sm.bill_date ASC, sm.sales_id ASC`;

/** DR lines on customer ledger not linked to a posted sale (opening balance, journals, etc.). */
const VOUCHER_ORPHAN_OUTSTANDING_SQL = `
  SELECT
    (-vm.voucher_master_id)::bigint AS bill_id,
    vm.voucher_master_id AS bill_no,
    vm.voucher_date AS bill_date,
    vd.debit_amount::numeric AS invoice_amount,
    GREATEST(
      COALESCE(NULLIF(vd.outstanding_balance, 0), vd.debit_amount, 0)::numeric
      - COALESCE((
        SELECT SUM(ctc.paid_amount)::numeric
        FROM accounts.cash_transaction_child ctc
        WHERE ctc.company_id = vd.company_id
          AND ctc.bill_id = (-vm.voucher_master_id)::bigint
      ), 0),
      0
    ) AS current_amount,
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
    AND vm.voucher_posted_id IS NULL
    AND (vd.record_status IS NULL OR TRIM(UPPER(vd.record_status)) = 'ACTIVE')
    AND GREATEST(
      COALESCE(NULLIF(vd.outstanding_balance, 0), vd.debit_amount, 0)::numeric
      - COALESCE((
        SELECT SUM(ctc.paid_amount)::numeric
        FROM accounts.cash_transaction_child ctc
        WHERE ctc.company_id = vd.company_id
          AND ctc.bill_id = (-vm.voucher_master_id)::bigint
      ), 0),
      0
    ) > 0.005
  ORDER BY vm.voucher_date ASC, vm.voucher_master_id ASC`;

/**
 * Ensure bill lines sum to ledger O/S (Tally-style net debit − credit).
 * Adds an "Opening / Other" line for any remainder not linked to open bills.
 */
export function reconcileBillsWithLedger(bills, ledgerOs, customerId) {
  const target = num(ledgerOs);
  const sum = bills.reduce((s, b) => s + num(b.currentAmount), 0);
  const diff = parseFloat((target - sum).toFixed(3));
  if (Math.abs(diff) <= 0.005) return bills;

  const reconciled = [...bills];
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
  }
  return reconciled.filter(b => b.currentAmount > 0.005);
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
      TRIM(COALESCE(sm.prefix, 'B-') || sm.bill_no::text) AS invoice_no
    FROM ops.sales_master sm
    WHERE sm.company_id = $1
      AND sm.customer_id = $2
      AND sm.amount > 0
      AND UPPER(TRIM(COALESCE(sm.payment_mode, ''))) = 'CREDIT'
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

export async function getOutstandingBills(db, companyId, customerId) {
  const [salesBills, creditSalesBills, voucherBills, orphanBills] = await Promise.all([
    querySalesBills(db, companyId, customerId),
    queryCreditCustomerSales(db, companyId, customerId),
    queryVoucherBills(db, companyId, customerId),
    queryOrphanVoucherBills(db, companyId, customerId),
  ]);
  return mergeOutstandingBills(salesBills, creditSalesBills, voucherBills, orphanBills);
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
         post_dated_cheque, total_current_amount, total_paid_amount,
         remarks, status, payment_mode, voucher_master_id,
         created_by, modified_by, counter_close_status
       ) VALUES (
         $1,$2,$3,$4,$5,
         $6,$7,$8,$9,
         false,$10,$11,
         $12,'ACTIVE',$13,$14,
         $15,$15,'PENDING'
       )`,
      baseParams,
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
         false,$10,$11,
         $12,'ACTIVE',$13,$14,
         $15,$15
       )`,
      baseParams,
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
       SET outstanding_balance = GREATEST(COALESCE(vd.outstanding_balance, 0) - $4, 0),
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
              GREATEST(COALESCE(NULLIF(vd.outstanding_balance, 0), vd.debit_amount, 0), 0)::numeric AS os
       FROM accounts.voucher_detail vd
       INNER JOIN accounts.voucher_master vm
         ON vm.company_id = vd.company_id
        AND vm.voucher_master_id = vd.voucher_master_id
       WHERE vd.company_id = $1
         AND vd.account_id = $2
         AND vd.debit_amount > 0
         AND vm.voucher_posted_id IS NULL
         AND (vd.record_status IS NULL OR TRIM(UPPER(vd.record_status)) = 'ACTIVE')
         AND GREATEST(COALESCE(NULLIF(vd.outstanding_balance, 0), vd.debit_amount, 0), 0) > 0.005
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
         SET outstanding_balance = GREATEST(COALESCE(vd.outstanding_balance, 0) - $4, 0),
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
