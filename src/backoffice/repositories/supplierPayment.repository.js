/**
 * Supplier payment — outstanding purchase bills + cash_transaction (payable side).
 */
import * as settlementRepo from '../../pos/counter-pos/repositories/settlement.repository.js';
import { resolvePurchasePaymentVoucherTypeIds } from '../lib/purchasePaymentOutstanding.js';

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

const PDC_PENDING_MASTER_SQL = `
  COALESCE(ctm.post_dated_cheque, false) = true
  AND UPPER(COALESCE(ctm.status, '')) = 'PDC_PENDING'`;

const CLEARED_PAID_SUBQUERY = `
  COALESCE((
    SELECT SUM(ctc.paid_amount)::numeric
    FROM accounts.cash_transaction_child ctc
    LEFT JOIN accounts.cash_transaction_master ctm
      ON ctm.company_id = ctc.company_id AND ctm.transaction_id = ctc.transaction_id
    WHERE ctc.company_id = p.company_id
      AND ctc.bill_id = p.purchase_id
      AND ctm.supplier_id = p.supplier_id
      AND ctm.customer_id IS NULL
      AND NOT (${PDC_PENDING_MASTER_SQL})
  ), 0)`;

const PDC_PAID_SUBQUERY = `
  COALESCE((
    SELECT SUM(ctc.paid_amount)::numeric
    FROM accounts.cash_transaction_child ctc
    INNER JOIN accounts.cash_transaction_master ctm
      ON ctm.company_id = ctc.company_id AND ctm.transaction_id = ctc.transaction_id
    WHERE ctc.company_id = p.company_id
      AND ctc.bill_id = p.purchase_id
      AND ctm.supplier_id = p.supplier_id
      AND ctm.customer_id IS NULL
      AND (${PDC_PENDING_MASTER_SQL})
  ), 0)`;

const PURCHASE_OS_BASE_EXPR = `
  CASE
    WHEN COALESCE(p.outstanding_balance, 0) > 0.005 THEN COALESCE(p.outstanding_balance, 0)
    ELSE GREATEST(COALESCE(p.invoice_amount, 0) - ${CLEARED_PAID_SUBQUERY}, 0)
  END`;

const PURCHASE_OUTSTANDING_SQL = `
  SELECT
    p.purchase_id AS bill_id,
    p.purchase_no AS bill_no,
    p.purchase_date AS bill_date,
    p.invoice_amount::numeric AS invoice_amount,
    (${PURCHASE_OS_BASE_EXPR})::numeric AS current_amount,
    ${PDC_PAID_SUBQUERY}::numeric AS pdc_pending,
    ${CLEARED_PAID_SUBQUERY}::numeric AS cleared_paid,
    TRIM(COALESCE(p.purchase_no::text, p.purchase_id::text)) AS invoice_no
  FROM ops.purchase_master p
  WHERE p.company_id = $1
    AND p.supplier_id = $2
    AND ($3::int IS NULL OR p.branch_id = $3::int)
    AND UPPER(COALESCE(p.post_status, 'PENDING')) = 'POSTED'
    AND COALESCE(UPPER(p.record_status), 'ACTIVE') NOT IN ('CANCELLED', 'VOID', 'CANCELED')
    AND (
      (${PURCHASE_OS_BASE_EXPR}) > 0.005
      OR ${PDC_PAID_SUBQUERY} > 0.005
    )
  ORDER BY p.purchase_date ASC, p.purchase_id ASC`;

function mapBillRow(r) {
  return {
    billId: Number(r.bill_id),
    billNo: r.bill_no,
    billDate: r.bill_date,
    invoiceNo: r.invoice_no,
    invoiceAmount: num(r.invoice_amount),
    currentAmount: num(r.current_amount),
    pdcPending: num(r.pdc_pending),
    clearedPaid: num(r.cleared_paid),
  };
}

export function reconcilePostedBills(bills) {
  return settlementRepo.reconcilePostedBills(bills);
}

export async function getSupplierById(db, companyId, supplierId) {
  const { rows } = await db.query(
    `SELECT supplier_id, supplier_code, supplier_name, payment_mode
     FROM biz.supplier_master
     WHERE company_id = $1 AND supplier_id = $2
       AND COALESCE(record_status, 'ACTIVE') = 'ACTIVE'
     LIMIT 1`,
    [companyId, supplierId],
  );
  return rows[0] ?? null;
}

export async function getSupplierOsBalance(db, companyId, supplierId, { postedOnly = false, branchId = null } = {}) {
  const postedFilter = postedOnly
    ? `AND EXISTS (
         SELECT 1 FROM accounts.voucher_master vm
         WHERE vm.company_id = vd.company_id
           AND vm.branch_id = vd.branch_id
           AND vm.voucher_master_id = vd.voucher_master_id
           AND (vm.record_status IS NULL OR TRIM(UPPER(vm.record_status)) = 'ACTIVE')
           AND UPPER(COALESCE(vm.post_status, 'PENDING')) = 'POSTED'
       )`
    : '';
  try {
    const { rows } = await db.query(
      `SELECT (COALESCE(SUM(vd.credit_amount), 0) - COALESCE(SUM(vd.debit_amount), 0))::numeric AS os
       FROM biz.supplier_master sm
       JOIN accounts.account_head_master ah
         ON ah.company_id = sm.company_id AND ah.account_no = sm.supplier_code
       LEFT JOIN accounts.voucher_detail vd
         ON vd.company_id = ah.company_id AND vd.account_id = ah.account_id
        AND (vd.record_status IS NULL OR TRIM(UPPER(vd.record_status)) = 'ACTIVE')
        AND ($3::int IS NULL OR vd.branch_id = $3::int)
        ${postedFilter}
       WHERE sm.company_id = $1 AND sm.supplier_id = $2`,
      [companyId, supplierId, branchId],
    );
    return num(rows[0]?.os);
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return 0;
    throw e;
  }
}

export async function getOutstandingPurchaseBills(db, companyId, supplierId, { branchId = null } = {}) {
  try {
    const { rows } = await db.query(PURCHASE_OUTSTANDING_SQL, [companyId, supplierId, branchId]);
    return rows.map(mapBillRow);
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return [];
    throw e;
  }
}

export async function assertPostedPurchaseAllocations(db, companyId, allocations) {
  for (const a of allocations) {
    const billId = Number(a.billId);
    if (!Number.isFinite(billId) || billId < 1) continue;
    const { rows } = await db.query(
      `SELECT purchase_id FROM ops.purchase_master
       WHERE company_id = $1 AND purchase_id = $2
         AND UPPER(COALESCE(post_status, 'PENDING')) = 'POSTED'
       LIMIT 1`,
      [companyId, billId],
    );
    if (!rows[0]) {
      const err = new Error(
        `Bill ${a.invoiceNo || billId} is not posted — post the purchase before payment`,
      );
      err.status = 400;
      throw err;
    }
  }
}

export async function updatePurchaseOutstanding(client, companyId, purchaseId, branchId, outstandingBalance) {
  await client.query(
    `UPDATE ops.purchase_master
     SET outstanding_balance = $4, modified_at = NOW()
     WHERE company_id = $1 AND purchase_id = $2 AND branch_id = $3`,
    [companyId, purchaseId, branchId, outstandingBalance],
  );
}

export async function getPurchaseOutstandingBalance(client, companyId, purchaseId, branchId) {
  const { rows } = await client.query(
    `SELECT outstanding_balance, invoice_amount FROM ops.purchase_master
     WHERE company_id = $1 AND purchase_id = $2 AND branch_id = $3 LIMIT 1`,
    [companyId, purchaseId, branchId],
  );
  if (!rows[0]) return 0;
  return num(rows[0].outstanding_balance, num(rows[0].invoice_amount));
}

export async function reducePurchaseBillOutstanding(client, companyId, branchId, purchaseId, supplierLedgerId, reduceBy) {
  const { purchaseVoucherTypeId } = await resolvePurchasePaymentVoucherTypeIds(client, companyId, branchId);
  await client.query(
    `UPDATE accounts.voucher_detail vd
     SET outstanding_balance = GREATEST(COALESCE(vd.outstanding_balance, 0) - $4, 0),
         modified_at = NOW()
     FROM accounts.voucher_master vm
     WHERE vd.company_id = $1
       AND vd.voucher_master_id = vm.voucher_master_id
       AND vm.company_id = $1
       AND vm.branch_id = $5
       AND vm.voucher_posted_id = $2
       AND vm.voucher_type_id = $6
       AND vm.creation_mode = 'INVENTORYACCOUNTS'
       AND vd.account_id = $3
       AND vd.credit_amount > 0`,
    [companyId, purchaseId, supplierLedgerId, reduceBy, branchId, purchaseVoucherTypeId],
  );
}

export async function restorePurchaseBillOutstanding(client, companyId, branchId, purchaseId, supplierLedgerId, restoreBy) {
  const { purchaseVoucherTypeId } = await resolvePurchasePaymentVoucherTypeIds(client, companyId, branchId);
  await client.query(
    `UPDATE accounts.voucher_detail vd
     SET outstanding_balance = LEAST(
           COALESCE(vd.credit_amount, 0),
           COALESCE(vd.outstanding_balance, 0) + $4
         ),
         modified_at = NOW()
     FROM accounts.voucher_master vm
     WHERE vd.company_id = $1
       AND vd.voucher_master_id = vm.voucher_master_id
       AND vm.company_id = $1
       AND vm.branch_id = $5
       AND vm.voucher_posted_id = $2
       AND vm.voucher_type_id = $6
       AND vm.creation_mode = 'INVENTORYACCOUNTS'
       AND vd.account_id = $3
       AND vd.credit_amount > 0`,
    [companyId, purchaseId, supplierLedgerId, restoreBy, branchId, purchaseVoucherTypeId],
  );
}

export async function syncSupplierPayableState(client, companyId, supplierId, supplierLedgerId) {
  try {
    await client.query(
      `UPDATE ops.purchase_master
       SET outstanding_balance = 0, modified_at = NOW()
       WHERE company_id = $1 AND supplier_id = $2
         AND COALESCE(outstanding_balance, 0) > 0.005`,
      [companyId, supplierId],
    );
  } catch (e) {
    if (e.code !== '42703') throw e;
  }
  if (!supplierLedgerId) return;
  try {
    await client.query(
      `UPDATE accounts.voucher_detail vd
       SET outstanding_balance = 0, modified_at = NOW()
       FROM accounts.voucher_master vm
       WHERE vd.company_id = $1 AND vd.account_id = $2
         AND vd.voucher_master_id = vm.voucher_master_id
         AND vm.company_id = $1 AND vd.credit_amount > 0
         AND COALESCE(vd.outstanding_balance, 0) > 0.005`,
      [companyId, supplierLedgerId],
    );
  } catch (e) {
    if (e.code !== '42P01' && e.code !== '42703') throw e;
  }
}

export async function insertSupplierPaymentMaster(client, row) {
  const postDatedCheque = Boolean(row.postDatedCheque);
  const status = row.status || (postDatedCheque ? 'PDC_PENDING' : 'ACTIVE');
  await client.query(
    `INSERT INTO accounts.cash_transaction_master (
       company_id, branch_id, transaction_id, transaction_no, transaction_date,
       counter_no, customer_id, supplier_id, amount, transaction_type,
       post_dated_cheque, cheque_details, cheque_date,
       total_current_amount, total_paid_amount,
       remarks, status, payment_mode, voucher_master_id,
       created_by, modified_by, counter_close_status
     ) VALUES (
       $1,$2,$3,$4,$5,
       $6,NULL,$7,$8,$9,
       $16,$17,$18,
       $10,$11,
       $12,$19,$13,$14,
       $15,$15,'PENDING'
     )`,
    [
      row.companyId, row.branchId, row.transactionId, row.transactionNo, row.transactionDate ?? new Date(),
      row.counterNo ?? null, row.supplierId, row.amount, row.transactionType ?? 'SUPPLIER PAYMENT',
      row.totalCurrentAmount, row.totalPaidAmount,
      row.remarks ?? null, row.paymentMode, row.voucherMasterId ?? null,
      row.createdBy,
      postDatedCheque, row.chequeDetails ?? null, row.chequeDate ?? null, status,
    ],
  );
}

export async function getSettlementPayment(db, companyId, branchId, transactionId) {
  const tid = Number(transactionId);
  const { rows: masters } = await db.query(
    `SELECT ctm.*, sm.supplier_code, sm.supplier_name
     FROM accounts.cash_transaction_master ctm
     LEFT JOIN biz.supplier_master sm
       ON sm.company_id = ctm.company_id AND sm.supplier_id = ctm.supplier_id
     WHERE ctm.company_id = $1 AND ctm.branch_id = $2 AND ctm.transaction_id = $3
     LIMIT 1`,
    [companyId, branchId, tid],
  );
  if (!masters.length) return null;

  const m = masters[0];
  const { rows: children } = await db.query(
    `SELECT transaction_child_id, bill_id, bill_date, invoice_no,
            invoice_amount, current_amount, paid_amount, balance, ledger_id
     FROM accounts.cash_transaction_child
     WHERE company_id = $1 AND transaction_id = $2
     ORDER BY bill_date ASC, bill_id ASC`,
    [companyId, tid],
  );

  let voucher = null;
  if (m.voucher_master_id != null) {
    const { rows: vRows } = await db.query(
      `SELECT voucher_master_id, voucher_prefix, auto_voucher_no, manual_voucher_no,
              voucher_date, voucher_amount, reference_no, remarks, post_status
       FROM accounts.voucher_master
       WHERE company_id = $1 AND voucher_master_id = $2 LIMIT 1`,
      [companyId, m.voucher_master_id],
    );
    if (vRows[0]) {
      voucher = {
        voucherMasterId: Number(vRows[0].voucher_master_id),
        voucherPrefix: vRows[0].voucher_prefix ?? '',
        autoVoucherNo: Number(vRows[0].auto_voucher_no),
        manualVoucherNo: vRows[0].manual_voucher_no ?? null,
        voucherDate: vRows[0].voucher_date,
        voucherAmount: num(vRows[0].voucher_amount),
        referenceNo: vRows[0].reference_no ?? null,
        remarks: vRows[0].remarks ?? null,
        postStatus: vRows[0].post_status ?? null,
      };
    }
  }

  const osBefore = num(m.total_current_amount);
  const paid = num(m.amount);

  return {
    transactionId: tid,
    transactionNo: Number(m.transaction_no),
    paymentNo: `PAY-${m.transaction_no || tid}`,
    transactionDate: m.transaction_date,
    supplierId: m.supplier_id != null ? Number(m.supplier_id) : null,
    supplierCode: m.supplier_code ?? null,
    supplierName: m.supplier_name ?? '—',
    paidAmount: paid,
    paymentMode: m.payment_mode ?? 'CASH',
    postDatedCheque: Boolean(m.post_dated_cheque) || String(m.payment_mode || '').toUpperCase() === 'CHEQUE',
    chequeDetails: m.cheque_details ?? null,
    chequeDate: m.cheque_date ?? null,
    status: m.status ?? 'ACTIVE',
    osBefore,
    osAfter: Math.max(osBefore - paid, 0),
    remarks: m.remarks ?? null,
    voucher,
    clearedBills: children.map((c) => ({
      billId: Number(c.bill_id),
      billDate: c.bill_date,
      invoiceNo: c.invoice_no ?? `B-${c.bill_id}`,
      invoiceAmount: num(c.invoice_amount),
      osBefore: num(c.current_amount),
      paidAmount: num(c.paid_amount),
      osAfter: num(c.balance),
      ledgerId: Number(c.ledger_id),
    })),
  };
}

export {
  settlementRepo,
};
