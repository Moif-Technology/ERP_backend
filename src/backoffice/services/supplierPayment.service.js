import { pool } from '../../config/db.js';
import * as settlementRepo from '../../pos/counter-pos/repositories/settlement.repository.js';
import * as supplierPaymentRepo from '../repositories/supplierPayment.repository.js';
import * as voucherRepo from '../../accounts/repositories/voucher.repository.js';
import { ensureSupplierLedgerForId } from './partyLedger.service.js';

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function round3(n) {
  return Math.round(num(n) * 1000) / 1000;
}

function parseBranchId(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
}

function isPdcPendingStatus(status) {
  return String(status || '').trim().toUpperCase() === 'PDC_PENDING';
}

function isBankReconciledStatus(status) {
  return String(status || '').trim().toUpperCase() === 'BANK_RECONCILED';
}

function parseBankReconFromRemarks(remarks) {
  const text = String(remarks || '');
  const dateMatch = text.match(/\[BR_DATE:([^\]]+)\]/);
  const refMatch = text.match(/\[BR_REF:([^\]]+)\]/);
  return {
    bankStatementDate: dateMatch?.[1] || null,
    bankReference: refMatch?.[1] || null,
  };
}

function appendBankReconRemarks(remarks, bankStatementDate, bankReference) {
  const base = String(remarks || '').replace(/\s*\[BR_DATE:[^\]]*\]/g, '').replace(/\s*\[BR_REF:[^\]]*\]/g, '').trim();
  const parts = [];
  if (bankStatementDate) parts.push(`[BR_DATE:${bankStatementDate}]`);
  if (bankReference) parts.push(`[BR_REF:${bankReference}]`);
  const merged = [base, ...parts].filter(Boolean).join(' ').trim();
  return merged.slice(0, 200);
}

function mapPaymentStatusFields(payment) {
  const paymentStatus = String(payment.status || 'ACTIVE').toUpperCase();
  const postDatedCheque = Boolean(payment.postDatedCheque)
    || String(payment.paymentMode || '').toUpperCase() === 'CHEQUE';
  const bankRecon = parseBankReconFromRemarks(payment.remarks);
  return {
    paymentStatus,
    postDatedCheque,
    pdcPending: postDatedCheque && isPdcPendingStatus(paymentStatus),
    pdcCleared: postDatedCheque && !isPdcPendingStatus(paymentStatus),
    bankReconciled: isBankReconciledStatus(paymentStatus),
    bankStatementDate: bankRecon.bankStatementDate,
    bankReference: bankRecon.bankReference,
  };
}

function allocateFifo(bills, paymentAmount) {
  let remaining = num(paymentAmount);
  const lines = [];
  for (const bill of bills) {
    if (remaining <= 0.005) break;
    const current = num(bill.currentAmount);
    if (current <= 0.005) continue;
    const paid = Math.min(remaining, current);
    const balance = round3(current - paid);
    lines.push({ ...bill, paidAmount: round3(paid), balance });
    remaining = round3(remaining - paid);
  }
  return lines;
}

function buildBillAllocations(bills, body) {
  const manual = Array.isArray(body.billAllocations) ? body.billAllocations : [];
  if (manual.length) {
    const map = new Map(bills.map((b) => [Number(b.billId), b]));
    const lines = [];
    for (const row of manual) {
      const billId = Number(row.billId);
      const paid = round3(row.paidAmount);
      if (!Number.isFinite(billId) || paid <= 0) continue;
      const bill = map.get(billId);
      if (!bill) {
        const err = new Error(`Bill #${billId} not found or already settled`);
        err.status = 400;
        throw err;
      }
      const current = num(bill.currentAmount);
      if (paid > current + 0.02) {
        const err = new Error(`Paid amount ${paid.toFixed(2)} exceeds bill O/S ${current.toFixed(2)} (${bill.invoiceNo || billId})`);
        err.status = 400;
        throw err;
      }
      lines.push({ ...bill, paidAmount: paid, balance: round3(current - paid) });
    }
    if (!lines.length) {
      const err = new Error('Enter paid amount on at least one bill');
      err.status = 400;
      throw err;
    }
    return lines;
  }

  const total = round3(body.totalAmount ?? body.amount);
  if (total <= 0) {
    const err = new Error('Payment amount must be greater than zero');
    err.status = 400;
    throw err;
  }
  const lines = allocateFifo(bills, total);
  if (!lines.length) {
    const err = new Error('Could not allocate payment to any bill');
    err.status = 400;
    throw err;
  }
  return lines;
}

function parsePaymentLines(body) {
  const paymentLinesRaw = Array.isArray(body.paymentLines) ? body.paymentLines : [];
  if (!paymentLinesRaw.length) {
    const err = new Error('Add at least one payment ledger line');
    err.status = 400;
    throw err;
  }
  const paymentLines = paymentLinesRaw
    .map((l) => ({
      ledgerId: Number(l.ledgerId ?? l.accountId),
      amount: round3(l.amount),
      narration: l.narration ? String(l.narration).trim().slice(0, 100) : null,
    }))
    .filter((l) => l.ledgerId > 0 && l.amount > 0);
  if (!paymentLines.length) {
    const err = new Error('Payment ledger lines must have account and amount');
    err.status = 400;
    throw err;
  }
  const paymentTotal = round3(paymentLines.reduce((s, l) => s + l.amount, 0));
  if (paymentTotal <= 0) {
    const err = new Error('Payment total must be greater than zero');
    err.status = 400;
    throw err;
  }
  return { paymentLines, paymentTotal };
}

async function insertSupplierPaymentVoucher(client, args) {
  const {
    companyId, branchId, transactionId, supplierLedgerId, paymentLines,
    amount, staffId, supplierCode, paymentDate, remarks, referenceNo,
    postStatus = 'PENDING', voucherMasterId: existingVoucherMasterId,
  } = args;

  const voucherTypeId =
    (await voucherRepo.getVoucherTypeId(client, companyId, 'PaymentVoucherNameSupplier', branchId)) ?? 4;
  const voucherPrefix =
    (await voucherRepo.getVoucherPrefix(client, companyId, voucherTypeId)) || 'PAY';

  const voucherMasterId = existingVoucherMasterId
    ?? await voucherRepo.nextVoucherMasterId(client, companyId, branchId);
  const auditBy = String(staffId ?? 'BACKOFFICE').slice(0, 50);
  const ref = referenceNo ? String(referenceNo).trim().slice(0, 100) : `PMT-${transactionId}`;
  const detailPostStatus = postStatus;
  let autoVoucherNo = null;

  if (!existingVoucherMasterId) {
    autoVoucherNo = await voucherRepo.nextAutoVoucherNo(client, companyId, branchId, voucherTypeId);
    await voucherRepo.insertVoucherMaster(client, {
      companyId,
      branchId,
      voucherMasterId,
      voucherTypeId,
      autoVoucherNo,
      manualVoucherNo: ref,
      voucherPrefix,
      voucherDate: paymentDate || new Date(),
      referenceNo: ref,
      voucherAmount: amount,
      remarks: remarks || `Supplier payment ${supplierCode} ${ref}`,
      postStatus,
      creationMode: 'BACKOFFICE',
      voucherPostedId: transactionId,
      counterCloseNo: 0,
      recordStatus: 'ACTIVE',
      createdBy: auditBy,
    });
  } else {
    await voucherRepo.updateVoucherMaster(client, companyId, branchId, voucherMasterId, {
      voucherDate: paymentDate || new Date(),
      referenceNo: ref,
      voucherAmount: amount,
      remarks: remarks || `Supplier payment ${supplierCode} ${ref}`,
    });
    await voucherRepo.deleteVoucherDetails(client, companyId, branchId, voucherMasterId);
  }

  let detailSeq = await voucherRepo.nextVoucherDetailId(client, companyId, branchId);

  for (const line of paymentLines) {
    await voucherRepo.insertVoucherDetail(client, {
      companyId,
      branchId,
      voucherDetailId: detailSeq++,
      voucherMasterId,
      accountId: line.ledgerId,
      debitAmount: line.amount,
      creditAmount: 0,
      outstandingBalance: 0,
      narration: line.narration || ref,
      postStatus: detailPostStatus,
      recordStatus: 'ACTIVE',
      createdBy: auditBy,
    });
  }

  await voucherRepo.insertVoucherDetail(client, {
    companyId,
    branchId,
    voucherDetailId: detailSeq++,
    voucherMasterId,
    accountId: supplierLedgerId,
    debitAmount: 0,
    creditAmount: amount,
    outstandingBalance: 0,
    narration: ref,
    postStatus: detailPostStatus,
    recordStatus: 'ACTIVE',
    createdBy: auditBy,
  });

  return { voucherMasterId, autoVoucherNo };
}

async function applyBillAllocations(client, companyId, branchId, allocations, supplierLedgerId, postDatedCheque) {
  if (postDatedCheque) return;
  for (const a of allocations) {
    if (a.billId > 0) {
      await supplierPaymentRepo.updatePurchaseOutstanding(client, companyId, a.billId, branchId, a.balance);
      await supplierPaymentRepo.reducePurchaseBillOutstanding(
        client, companyId, branchId, a.billId, supplierLedgerId, a.paidAmount,
      );
    }
  }
}

async function reverseBillAllocations(client, companyId, branchId, allocations, supplierLedgerId, postDatedCheque) {
  if (postDatedCheque) return;
  for (const a of allocations) {
    if (a.billId > 0) {
      const currentOs = await supplierPaymentRepo.getPurchaseOutstandingBalance(client, companyId, a.billId, branchId);
      await supplierPaymentRepo.updatePurchaseOutstanding(
        client, companyId, a.billId, branchId, round3(currentOs + a.paidAmount),
      );
      await supplierPaymentRepo.restorePurchaseBillOutstanding(
        client, companyId, branchId, a.billId, supplierLedgerId, a.paidAmount,
      );
    }
  }
}

async function loadPaymentAllocations(client, companyId, transactionId) {
  const { rows } = await client.query(
    `SELECT bill_id, bill_date, invoice_no, invoice_amount, current_amount, paid_amount, balance, ledger_id
     FROM accounts.cash_transaction_child
     WHERE company_id = $1 AND transaction_id = $2
     ORDER BY bill_date ASC, bill_id ASC`,
    [companyId, Number(transactionId)],
  );
  return rows.map((c) => ({
    billId: Number(c.bill_id),
    billDate: c.bill_date,
    invoiceNo: c.invoice_no ?? `B-${c.bill_id}`,
    invoiceAmount: num(c.invoice_amount),
    currentAmount: num(c.current_amount),
    paidAmount: num(c.paid_amount),
    balance: num(c.balance),
    ledgerId: Number(c.ledger_id),
  }));
}

function mapPaymentResponse(args) {
  const {
    transactionId, transactionNo, voucherMasterId, voucherPrefix, autoVoucherNo,
    postStatus, supplierId, supplier, paymentTotal, paymentMode, postDatedCheque,
    osAmount, newOsInTxn, allocations, paymentLines, referenceNo, paymentDate, remarks,
    chequeDetails, chequeDate, branchId, message,
  } = args;
  const voucherNo = voucherMasterId
    ? `${voucherPrefix || 'PAY'}${autoVoucherNo ?? transactionNo ?? transactionId}`
    : null;
  return {
    transactionId,
    transactionNo,
    voucherMasterId,
    voucherNo,
    postStatus: postStatus || 'PENDING',
    branchId,
    supplierId,
    supplierCode: supplier.supplier_code,
    supplierName: supplier.supplier_name,
    referenceNo: referenceNo || null,
    paymentDate,
    remarks,
    amount: paymentTotal,
    paymentMode,
    postDatedCheque,
    chequeDetails,
    chequeDate,
    osBefore: osAmount,
    osAfter: newOsInTxn <= 0.005 ? 0 : newOsInTxn,
    billAllocations: allocations.map((a) => ({
      billId: a.billId,
      invoiceNo: a.invoiceNo,
      billDate: a.billDate,
      invoiceAmount: a.invoiceAmount,
      currentAmount: a.currentAmount,
      paidAmount: a.paidAmount,
      balance: a.balance,
    })),
    paymentLines,
    message,
  };
}

async function assertPaymentEditable(db, companyId, branchId, transactionId) {
  const payment = await supplierPaymentRepo.getSettlementPayment(db, companyId, branchId, transactionId);
  if (!payment) {
    const err = new Error('Payment not found');
    err.status = 404;
    throw err;
  }
  if (payment.voucher?.postStatus === 'POSTED') {
    const err = new Error('Payment is posted — unpost before editing');
    err.status = 409;
    throw err;
  }
  return payment;
}

async function persistPaymentChildren(client, args) {
  const {
    companyId, branchId, transactionId, allocations, supplierLedgerId,
    postDatedCheque, auditBy,
  } = args;
  await settlementRepo.deleteCashTransactionChildren(client, companyId, transactionId);
  const childIdBase = await settlementRepo.nextTransactionChildIdBase(client, companyId, allocations.length);
  for (let i = 0; i < allocations.length; i += 1) {
    const a = allocations[i];
    await settlementRepo.insertCashTransactionChild(client, {
      companyId,
      branchId,
      transactionChildId: childIdBase + i,
      transactionId,
      billId: a.billId,
      billDate: a.billDate,
      invoiceNo: a.invoiceNo,
      invoiceAmount: a.invoiceAmount,
      currentAmount: a.currentAmount,
      paidAmount: a.paidAmount,
      balance: postDatedCheque ? a.currentAmount : a.balance,
      ledgerId: supplierLedgerId,
      createdBy: auditBy,
    });
  }
}

export async function listSupplierPaymentOutstanding(authStaff, supplierId) {
  const companyId = Number(authStaff.company_id);
  const sid = Number(supplierId);
  if (!Number.isFinite(sid) || sid < 1) {
    const err = new Error('Invalid supplier');
    err.status = 400;
    throw err;
  }

  const supplier = await supplierPaymentRepo.getSupplierById(pool, companyId, sid);
  if (!supplier) {
    const err = new Error('Supplier not found');
    err.status = 404;
    throw err;
  }

  const ledgerOs = await supplierPaymentRepo.getSupplierOsBalance(pool, companyId, sid, { postedOnly: true });
  const rawBills = await supplierPaymentRepo.getOutstandingPurchaseBills(pool, companyId, sid);
  const bills = supplierPaymentRepo.reconcilePostedBills(rawBills);
  const billsSum = bills.reduce((sum, b) => sum + num(b.currentAmount), 0);
  const alignedLedgerOs = billsSum > 0.005 ? billsSum : Math.max(ledgerOs, 0);

  return {
    supplierId: sid,
    supplierCode: supplier.supplier_code,
    supplierName: supplier.supplier_name,
    ledgerOs: alignedLedgerOs,
    billsTotal: billsSum,
    billsSum,
    osAmount: alignedLedgerOs,
    bills,
  };
}

export async function getSupplierPaymentByVoucher(authStaff, voucherMasterId) {
  const companyId = Number(authStaff.company_id);
  const row = await settlementRepo.getCashTransactionByVoucherMasterId(pool, companyId, voucherMasterId);
  if (row && row.supplier_id == null && row.customer_id != null) {
    const err = new Error('Supplier payment not found for this voucher');
    err.status = 404;
    throw err;
  }
  if (!row) {
    const err = new Error('Supplier payment not found for this voucher');
    err.status = 404;
    throw err;
  }
  return getSupplierPayment(authStaff, row.transaction_id, Number(row.branch_id));
}

export async function getSupplierPayment(authStaff, transactionId, branchIdOverride) {
  const companyId = Number(authStaff.company_id);
  let branchId = parseBranchId(branchIdOverride) ?? parseBranchId(authStaff.branch_id);
  if (!branchId) {
    const row = await pool.query(
      `SELECT branch_id FROM accounts.cash_transaction_master
       WHERE company_id = $1 AND transaction_id = $2 LIMIT 1`,
      [companyId, Number(transactionId)],
    ).then((r) => r.rows[0]);
    branchId = parseBranchId(row?.branch_id);
  }
  if (!branchId) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }

  const payment = await supplierPaymentRepo.getSettlementPayment(pool, companyId, branchId, transactionId);
  if (!payment) {
    const err = new Error('Payment not found');
    err.status = 404;
    throw err;
  }

  let paymentLines = [];
  if (payment.voucher?.voucherMasterId) {
    const voucher = await voucherRepo.getVoucherWithDetails(
      pool, companyId, branchId, payment.voucher.voucherMasterId,
    );
    paymentLines = (voucher?.details || [])
      .filter((d) => num(d.credit_amount) > 0)
      .map((d) => ({
        ledgerId: Number(d.account_id),
        amount: num(d.credit_amount),
        accountNo: d.account_no,
        accountHead: d.account_head,
      }));
  }

  const postDatedCheque = Boolean(payment.postDatedCheque)
    || String(payment.paymentMode || '').toUpperCase() === 'CHEQUE';
  const statusFields = mapPaymentStatusFields(payment);
  return {
    transactionId: payment.transactionId,
    transactionNo: payment.transactionNo,
    voucherMasterId: payment.voucher?.voucherMasterId ?? null,
    voucherNo: payment.voucher
      ? `${payment.voucher.voucherPrefix || 'PAY'}${payment.voucher.autoVoucherNo || payment.transactionNo}`
      : payment.paymentNo,
    postStatus: payment.voucher?.postStatus || 'PENDING',
    branchId,
    supplierId: payment.supplierId,
    supplierCode: payment.supplierCode,
    supplierName: payment.supplierName,
    referenceNo: payment.voucher?.referenceNo || null,
    paymentDate: payment.transactionDate,
    remarks: payment.remarks,
    amount: payment.paidAmount,
    paymentMode: payment.paymentMode,
    postDatedCheque,
    chequeDetails: payment.chequeDetails ?? null,
    chequeDate: payment.chequeDate ?? null,
    ...statusFields,
    osBefore: payment.osBefore,
    osAfter: payment.osAfter,
    billAllocations: (payment.clearedBills || []).map((b) => ({
      billId: b.billId,
      invoiceNo: b.invoiceNo,
      billDate: b.billDate,
      invoiceAmount: b.invoiceAmount,
      currentAmount: b.osBefore,
      paidAmount: b.paidAmount,
      balance: b.osAfter,
    })),
    paymentLines,
  };
}

export async function saveSupplierPayment(authStaff, body) {
  const companyId = Number(authStaff.company_id);
  const branchId = parseBranchId(body.branchId) ?? parseBranchId(authStaff.branch_id);
  if (!branchId) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }

  const supplierId = Number(body.supplierId);
  const staffId = Number(authStaff.staff_id ?? authStaff.id);
  const postDatedCheque = Boolean(body.postDatedCheque);
  const chequeDetails = body.chequeDetails ? String(body.chequeDetails).trim().slice(0, 200) : null;
  const chequeDate = body.chequeDate || null;
  const paymentDate = body.paymentDate ? new Date(body.paymentDate) : new Date();
  const remarks = body.remarks ? String(body.remarks).trim().slice(0, 200) : null;
  const referenceNo = body.referenceNo ? String(body.referenceNo).trim().slice(0, 100) : null;

  if (!Number.isFinite(supplierId) || supplierId < 1) {
    const err = new Error('Supplier is required');
    err.status = 400;
    throw err;
  }

  const { paymentLines, paymentTotal } = parsePaymentLines(body);

  const supplier = await supplierPaymentRepo.getSupplierById(pool, companyId, supplierId);
  if (!supplier) {
    const err = new Error('Supplier not found');
    err.status = 404;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const osAmount = await supplierPaymentRepo.getSupplierOsBalance(client, companyId, supplierId, { postedOnly: true });
    const rawBills = await supplierPaymentRepo.getOutstandingPurchaseBills(client, companyId, supplierId);
    const bills = supplierPaymentRepo.reconcilePostedBills(rawBills);

    if (!bills.length) {
      const err = new Error('No posted outstanding bills found for this supplier — post the purchase first');
      err.status = 400;
      throw err;
    }

    const allocations = buildBillAllocations(bills, body);
    await supplierPaymentRepo.assertPostedPurchaseAllocations(client, companyId, allocations);
    const billPaidTotal = round3(allocations.reduce((s, a) => s + num(a.paidAmount), 0));

    if (Math.abs(billPaidTotal - paymentTotal) > 0.05) {
      const err = new Error(
        `Bill paid total (${billPaidTotal.toFixed(2)}) must match payment ledger total (${paymentTotal.toFixed(2)})`,
      );
      err.status = 400;
      throw err;
    }

    const payableTotal = bills.reduce((s, b) => s + num(b.currentAmount), 0);
    if (billPaidTotal > payableTotal + 0.05) {
      const err = new Error(`Amount cannot exceed supplier outstanding (${payableTotal.toFixed(2)})`);
      err.status = 400;
      throw err;
    }

    const supplierLedgerId = await ensureSupplierLedgerForId(client, companyId, branchId, supplierId);
    if (!supplierLedgerId) {
      const err = new Error('Supplier payable ledger not found — create supplier ledger first');
      err.status = 400;
      throw err;
    }

    const transactionId = await settlementRepo.nextTransactionId(client, companyId);
    const transactionNo = await settlementRepo.nextTransactionNo(client, companyId, branchId);
    const auditBy = String(staffId).slice(0, 50);
    const paymentMode = postDatedCheque
      ? 'CHEQUE'
      : (body.paymentMode ? String(body.paymentMode).toUpperCase() : 'CASH');

    let voucherMasterId = null;
    let voucherPrefix = 'PAY';
    let autoVoucherNo = null;
    try {
      await client.query('SAVEPOINT supplier_payment_voucher');
      const voucherResult = await insertSupplierPaymentVoucher(client, {
        companyId,
        branchId,
        transactionId,
        supplierLedgerId,
        paymentLines,
        amount: paymentTotal,
        staffId,
        supplierCode: supplier.supplier_code,
        paymentDate,
        remarks,
        referenceNo,
        postStatus: 'PENDING',
      });
      voucherMasterId = voucherResult.voucherMasterId;
      autoVoucherNo = voucherResult.autoVoucherNo;
      voucherPrefix = (await voucherRepo.getVoucherPrefix(
        client, companyId,
        (await voucherRepo.getVoucherTypeId(client, companyId, 'PaymentVoucherNameSupplier', branchId)) ?? 4,
      )) || 'PAY';
      await client.query('RELEASE SAVEPOINT supplier_payment_voucher');
    } catch (vErr) {
      await client.query('ROLLBACK TO SAVEPOINT supplier_payment_voucher').catch(() => {});
      if (vErr.code !== '42P01' && vErr.code !== '42703') throw vErr;
      console.warn('[backoffice] Supplier payment voucher skipped:', vErr.message);
    }

    await supplierPaymentRepo.insertSupplierPaymentMaster(client, {
      companyId,
      branchId,
      transactionId,
      transactionNo,
      transactionDate: paymentDate,
      counterNo: num(body.counterNo, 0) || null,
      supplierId,
      amount: paymentTotal,
      totalCurrentAmount: osAmount,
      totalPaidAmount: paymentTotal,
      paymentMode,
      voucherMasterId,
      postDatedCheque,
      chequeDetails: postDatedCheque ? chequeDetails : null,
      chequeDate: postDatedCheque ? chequeDate : null,
      status: postDatedCheque ? 'PDC_PENDING' : 'DRAFT',
      remarks: remarks || `Backoffice supplier payment — ${supplier.supplier_code}${postDatedCheque ? ' [PDC]' : ''}`,
      createdBy: auditBy,
    });

    await persistPaymentChildren(client, {
      companyId, branchId, transactionId, allocations, supplierLedgerId, postDatedCheque, auditBy,
    });

    await client.query('COMMIT');

    return mapPaymentResponse({
      transactionId,
      transactionNo,
      voucherMasterId,
      voucherPrefix,
      autoVoucherNo,
      postStatus: 'PENDING',
      supplierId,
      supplier,
      paymentTotal,
      paymentMode,
      postDatedCheque,
      osAmount,
      newOsInTxn: osAmount,
      allocations,
      paymentLines,
      referenceNo,
      paymentDate,
      remarks,
      chequeDetails,
      chequeDate,
      branchId,
      message: 'Supplier payment saved. Post when ready.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateSupplierPayment(authStaff, transactionId, body) {
  const companyId = Number(authStaff.company_id);
  const branchId = parseBranchId(body.branchId) ?? parseBranchId(authStaff.branch_id);
  if (!branchId) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }

  const tid = Number(transactionId);
  const supplierId = Number(body.supplierId);
  const staffId = Number(authStaff.staff_id ?? authStaff.id);
  const postDatedCheque = Boolean(body.postDatedCheque);
  const chequeDetails = body.chequeDetails ? String(body.chequeDetails).trim().slice(0, 200) : null;
  const chequeDate = body.chequeDate || null;
  const paymentDate = body.paymentDate ? new Date(body.paymentDate) : new Date();
  const remarks = body.remarks ? String(body.remarks).trim().slice(0, 200) : null;
  const referenceNo = body.referenceNo ? String(body.referenceNo).trim().slice(0, 100) : null;

  const { paymentLines, paymentTotal } = parsePaymentLines(body);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await assertPaymentEditable(client, companyId, branchId, tid);

    const supplier = await supplierPaymentRepo.getSupplierById(client, companyId, supplierId);
    if (!supplier) {
      const err = new Error('Supplier not found');
      err.status = 404;
      throw err;
    }

    const osAmount = await supplierPaymentRepo.getSupplierOsBalance(client, companyId, supplierId, { postedOnly: true });
    const rawBills = await supplierPaymentRepo.getOutstandingPurchaseBills(client, companyId, supplierId);
    const bills = supplierPaymentRepo.reconcilePostedBills(rawBills);

    if (!bills.length) {
      const err = new Error('No posted outstanding bills found for this supplier — post the purchase first');
      err.status = 400;
      throw err;
    }

    const allocations = buildBillAllocations(bills, body);
    await supplierPaymentRepo.assertPostedPurchaseAllocations(client, companyId, allocations);
    const billPaidTotal = round3(allocations.reduce((s, a) => s + num(a.paidAmount), 0));

    if (Math.abs(billPaidTotal - paymentTotal) > 0.05) {
      const err = new Error(
        `Bill paid total (${billPaidTotal.toFixed(2)}) must match payment ledger total (${paymentTotal.toFixed(2)})`,
      );
      err.status = 400;
      throw err;
    }

    const payableTotal = bills.reduce((s, b) => s + num(b.currentAmount), 0);
    if (billPaidTotal > payableTotal + 0.05) {
      const err = new Error(`Amount cannot exceed supplier outstanding (${payableTotal.toFixed(2)})`);
      err.status = 400;
      throw err;
    }

    const supplierLedgerId = await ensureSupplierLedgerForId(client, companyId, branchId, supplierId);
    const auditBy = String(staffId).slice(0, 50);
    const paymentMode = postDatedCheque ? 'CHEQUE' : (body.paymentMode ? String(body.paymentMode).toUpperCase() : 'CASH');
    const voucherMasterId = existing.voucher?.voucherMasterId ?? null;

    if (voucherMasterId) {
      await insertSupplierPaymentVoucher(client, {
        companyId,
        branchId,
        transactionId: tid,
        supplierLedgerId,
        paymentLines,
        amount: paymentTotal,
        staffId,
        supplierCode: supplier.supplier_code,
        paymentDate,
        remarks,
        referenceNo,
        postStatus: 'PENDING',
        voucherMasterId,
      });
    }

    await settlementRepo.updateCashTransactionMaster(client, companyId, branchId, tid, {
      amount: paymentTotal,
      totalCurrentAmount: osAmount,
      transactionDate: paymentDate,
      remarks: remarks || `Backoffice supplier payment — ${supplier.supplier_code}${postDatedCheque ? ' [PDC]' : ''}`,
      paymentMode,
      postDatedCheque,
      chequeDetails: postDatedCheque ? chequeDetails : null,
      chequeDate: postDatedCheque ? chequeDate : null,
      status: postDatedCheque ? 'PDC_PENDING' : 'DRAFT',
    });

    await persistPaymentChildren(client, {
      companyId, branchId, transactionId: tid, allocations, supplierLedgerId, postDatedCheque, auditBy,
    });

    await client.query('COMMIT');

    return mapPaymentResponse({
      transactionId: tid,
      transactionNo: existing.transactionNo,
      voucherMasterId,
      voucherPrefix: existing.voucher?.voucherPrefix || 'PAY',
      autoVoucherNo: existing.voucher?.autoVoucherNo || existing.transactionNo,
      postStatus: 'PENDING',
      supplierId,
      supplier,
      paymentTotal,
      paymentMode,
      postDatedCheque,
      osAmount,
      newOsInTxn: osAmount,
      allocations,
      paymentLines,
      referenceNo,
      paymentDate,
      remarks,
      chequeDetails,
      chequeDate,
      branchId,
      message: 'Supplier payment updated.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function postSupplierPayment(authStaff, transactionId, query = {}) {
  const companyId = Number(authStaff.company_id);
  const branchId = parseBranchId(query.branchId) ?? parseBranchId(authStaff.branch_id);
  if (!branchId) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }

  const tid = Number(transactionId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const payment = await supplierPaymentRepo.getSettlementPayment(client, companyId, branchId, tid);
    if (!payment) {
      const err = new Error('Payment not found');
      err.status = 404;
      throw err;
    }
    if (payment.voucher?.postStatus === 'POSTED') {
      const err = new Error('Payment is already posted');
      err.status = 409;
      throw err;
    }

    const supplierId = payment.supplierId;
    const supplierLedgerId = await ensureSupplierLedgerForId(client, companyId, branchId, supplierId);
    const allocations = await loadPaymentAllocations(client, companyId, tid);
    const postDatedCheque = Boolean(payment.postDatedCheque)
      || String(payment.paymentMode || '').toUpperCase() === 'CHEQUE';

    await applyBillAllocations(client, companyId, branchId, allocations, supplierLedgerId, postDatedCheque);

    if (payment.voucher?.voucherMasterId) {
      await voucherRepo.updateVoucherPostStatus(
        client, companyId, branchId, payment.voucher.voucherMasterId, 'POSTED',
      );
    }

    await settlementRepo.updateCashTransactionMaster(client, companyId, branchId, tid, {
      status: postDatedCheque ? 'PDC_PENDING' : 'ACTIVE',
    });

    const newOsInTxn = await supplierPaymentRepo.getSupplierOsBalance(client, companyId, supplierId);
    if (newOsInTxn <= 0.005) {
      await supplierPaymentRepo.syncSupplierPayableState(client, companyId, supplierId, supplierLedgerId);
    }

    await client.query('COMMIT');

    return {
      transactionId: tid,
      voucherMasterId: payment.voucher?.voucherMasterId ?? null,
      postStatus: 'POSTED',
      osAfter: newOsInTxn <= 0.005 ? 0 : newOsInTxn,
      message: postDatedCheque
        ? 'PDC payment posted — bill O/S clears when cheque is deposited/cleared.'
        : 'Supplier payment posted.',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function unpostSupplierPayment(authStaff, transactionId, query = {}) {
  const companyId = Number(authStaff.company_id);
  const branchId = parseBranchId(query.branchId) ?? parseBranchId(authStaff.branch_id);
  if (!branchId) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }

  const tid = Number(transactionId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const payment = await supplierPaymentRepo.getSettlementPayment(client, companyId, branchId, tid);
    if (!payment) {
      const err = new Error('Payment not found');
      err.status = 404;
      throw err;
    }
    if (payment.voucher?.postStatus !== 'POSTED') {
      const err = new Error('Payment is not posted');
      err.status = 409;
      throw err;
    }

    const supplierId = payment.supplierId;
    const supplierLedgerId = await ensureSupplierLedgerForId(client, companyId, branchId, supplierId);
    const allocations = await loadPaymentAllocations(client, companyId, tid);
    if (isBankReconciledStatus(payment.status)) {
      const err = new Error('Bank-reconciled payment cannot be unposted');
      err.status = 409;
      throw err;
    }
    const pdcPending = isPdcPendingStatus(payment.status);
    const postDatedCheque = Boolean(payment.postDatedCheque)
      || String(payment.paymentMode || '').toUpperCase() === 'CHEQUE';

    await reverseBillAllocations(client, companyId, branchId, allocations, supplierLedgerId, pdcPending);

    if (payment.voucher?.voucherMasterId) {
      await voucherRepo.updateVoucherPostStatus(
        client, companyId, branchId, payment.voucher.voucherMasterId, 'PENDING',
      );
    }

    await settlementRepo.updateCashTransactionMaster(client, companyId, branchId, tid, {
      status: postDatedCheque ? 'PDC_PENDING' : 'DRAFT',
    });

    await client.query('COMMIT');

    return {
      transactionId: tid,
      voucherMasterId: payment.voucher?.voucherMasterId ?? null,
      postStatus: 'PENDING',
      message: 'Supplier payment unposted — you can edit and post again.',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** POST /receipts/:id/clear-pdc — cheque deposited; reduce bill O/S. */
export async function clearPdcSupplierPayment(authStaff, transactionId, query = {}) {
  const companyId = Number(authStaff.company_id);
  const branchId = parseBranchId(query.branchId) ?? parseBranchId(authStaff.branch_id);
  if (!branchId) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }

  const tid = Number(transactionId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const payment = await supplierPaymentRepo.getSettlementPayment(client, companyId, branchId, tid);
    if (!payment) {
      const err = new Error('Payment not found');
      err.status = 404;
      throw err;
    }
    if (payment.voucher?.postStatus !== 'POSTED') {
      const err = new Error('Payment must be posted before clearing PDC');
      err.status = 409;
      throw err;
    }
    if (!isPdcPendingStatus(payment.status)) {
      const err = new Error('Payment is not pending PDC clearance');
      err.status = 409;
      throw err;
    }

    const supplierId = payment.supplierId;
    const supplierLedgerId = await ensureSupplierLedgerForId(client, companyId, branchId, supplierId);
    const allocations = (await loadPaymentAllocations(client, companyId, tid)).map((a) => ({
      ...a,
      balance: round3(Math.max(a.currentAmount - a.paidAmount, 0)),
    }));

    await applyBillAllocations(client, companyId, branchId, allocations, supplierLedgerId, false);
    await settlementRepo.updateCashTransactionChildBalances(client, companyId, tid, allocations);

    await settlementRepo.updateCashTransactionMaster(client, companyId, branchId, tid, {
      status: 'ACTIVE',
    });

    const newOsInTxn = await supplierPaymentRepo.getSupplierOsBalance(client, companyId, supplierId);
    if (newOsInTxn <= 0.005) {
      await supplierPaymentRepo.syncSupplierPayableState(client, companyId, supplierId, supplierLedgerId);
    }

    await client.query('COMMIT');

    return {
      transactionId: tid,
      paymentStatus: 'ACTIVE',
      pdcPending: false,
      pdcCleared: true,
      bankReconciled: false,
      osAfter: newOsInTxn <= 0.005 ? 0 : newOsInTxn,
      message: 'PDC cleared — bill O/S updated. You can now mark bank reconciliation.',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** POST /receipts/:id/bank-reconcile — match cleared PDC with bank statement. */
export async function reconcileBankSupplierPayment(authStaff, transactionId, body = {}, query = {}) {
  const companyId = Number(authStaff.company_id);
  const branchId = parseBranchId(query.branchId) ?? parseBranchId(body.branchId) ?? parseBranchId(authStaff.branch_id);
  if (!branchId) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }

  const bankStatementDate = body.bankStatementDate ? String(body.bankStatementDate).trim().slice(0, 10) : null;
  const bankReference = body.bankReference ? String(body.bankReference).trim().slice(0, 100) : null;
  if (!bankStatementDate) {
    const err = new Error('Bank statement date is required');
    err.status = 400;
    throw err;
  }

  const tid = Number(transactionId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const payment = await supplierPaymentRepo.getSettlementPayment(client, companyId, branchId, tid);
    if (!payment) {
      const err = new Error('Payment not found');
      err.status = 404;
      throw err;
    }
    if (payment.voucher?.postStatus !== 'POSTED') {
      const err = new Error('Payment must be posted before bank reconciliation');
      err.status = 409;
      throw err;
    }
    if (!payment.postDatedCheque && String(payment.paymentMode || '').toUpperCase() !== 'CHEQUE') {
      const err = new Error('Bank reconciliation applies to PDC payments only');
      err.status = 409;
      throw err;
    }
    if (isPdcPendingStatus(payment.status)) {
      const err = new Error('Clear PDC first before bank reconciliation');
      err.status = 409;
      throw err;
    }
    if (isBankReconciledStatus(payment.status)) {
      const err = new Error('Payment is already bank-reconciled');
      err.status = 409;
      throw err;
    }

    const remarks = appendBankReconRemarks(payment.remarks, bankStatementDate, bankReference);
    await settlementRepo.updateCashTransactionMaster(client, companyId, branchId, tid, {
      status: 'BANK_RECONCILED',
      remarks,
    });

    await client.query('COMMIT');

    return {
      transactionId: tid,
      paymentStatus: 'BANK_RECONCILED',
      pdcPending: false,
      pdcCleared: true,
      bankReconciled: true,
      bankStatementDate,
      bankReference,
      remarks,
      message: 'Bank reconciliation completed.',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
