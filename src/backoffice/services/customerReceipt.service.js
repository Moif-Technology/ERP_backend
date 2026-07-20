import { pool } from '../../config/db.js';
import * as settlementRepo from '../../pos/counter-pos/repositories/settlement.repository.js';
import * as customerRepo from '../../pos/counter-pos/repositories/customer.repository.js';
import * as voucherRepo from '../../accounts/repositories/voucher.repository.js';
import { ensureCustomerLedgerForId } from './partyLedger.service.js';
import { getCustomerOutstandingBills } from '../../pos/counter-pos/services/settlement.service.js';

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

function mapReceiptStatusFields(receipt) {
  const receiptStatus = String(receipt.status || 'ACTIVE').toUpperCase();
  const postDatedCheque = Boolean(receipt.postDatedCheque)
    || String(receipt.paymentMode || '').toUpperCase() === 'CHEQUE';
  const bankRecon = parseBankReconFromRemarks(receipt.remarks);
  return {
    receiptStatus,
    postDatedCheque,
    pdcPending: postDatedCheque && isPdcPendingStatus(receiptStatus),
    pdcCleared: postDatedCheque && !isPdcPendingStatus(receiptStatus),
    bankReconciled: isBankReconciledStatus(receiptStatus),
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
    const err = new Error('Receipt amount must be greater than zero');
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

async function insertCustomerReceiptVoucher(client, args) {
  const {
    companyId, branchId, transactionId, customerLedgerId, paymentLines,
    amount, staffId, customerCode, receiptDate, remarks, referenceNo,
    postStatus = 'PENDING', voucherMasterId: existingVoucherMasterId,
  } = args;

  const voucherTypeId =
    (await voucherRepo.getVoucherTypeId(client, companyId, 'ReceiptVoucherNameCustomer', branchId)) ?? 9;
  const voucherPrefix =
    (await voucherRepo.getVoucherPrefix(client, companyId, voucherTypeId)) || 'RCV';

  const voucherMasterId = existingVoucherMasterId
    ?? await voucherRepo.nextVoucherMasterId(client, companyId, branchId);
  const auditBy = String(staffId ?? 'BACKOFFICE').slice(0, 50);
  const ref = referenceNo ? String(referenceNo).trim().slice(0, 100) : `RCT-${transactionId}`;
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
      voucherDate: receiptDate || new Date(),
      referenceNo: ref,
      voucherAmount: amount,
      remarks: remarks || `Customer receipt ${customerCode} ${ref}`,
      postStatus,
      creationMode: 'BACKOFFICE',
      voucherPostedId: transactionId,
      counterCloseNo: 0,
      recordStatus: 'ACTIVE',
      createdBy: auditBy,
    });
  } else {
    await voucherRepo.updateVoucherMaster(client, companyId, branchId, voucherMasterId, {
      voucherDate: receiptDate || new Date(),
      referenceNo: ref,
      voucherAmount: amount,
      remarks: remarks || `Customer receipt ${customerCode} ${ref}`,
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
    accountId: customerLedgerId,
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

async function applyBillAllocations(client, companyId, allocations, customerLedgerId, postDatedCheque) {
  if (postDatedCheque) return;
  for (const a of allocations) {
    if (a.billId > 0) {
      await settlementRepo.updateSalesOutstanding(client, companyId, a.billId, a.balance);
      await settlementRepo.reduceSaleVoucherOutstanding(
        client, companyId, a.billId, customerLedgerId, a.paidAmount,
      );
    } else {
      await settlementRepo.reduceOrphanVoucherOutstanding(
        client, companyId, a.billId, customerLedgerId, a.paidAmount,
      );
    }
  }
}

async function reverseBillAllocations(client, companyId, allocations, customerLedgerId, postDatedCheque) {
  if (postDatedCheque) return;
  for (const a of allocations) {
    if (a.billId > 0) {
      const currentOs = await settlementRepo.getSalesOutstandingBalance(client, companyId, a.billId);
      await settlementRepo.updateSalesOutstanding(client, companyId, a.billId, round3(currentOs + a.paidAmount));
      await settlementRepo.restoreSaleVoucherOutstanding(
        client, companyId, a.billId, customerLedgerId, a.paidAmount,
      );
    } else {
      await settlementRepo.restoreOrphanVoucherOutstanding(
        client, companyId, a.billId, customerLedgerId, a.paidAmount,
      );
    }
  }
}

async function loadReceiptAllocations(client, companyId, transactionId) {
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

function mapReceiptResponse(args) {
  const {
    transactionId, transactionNo, voucherMasterId, voucherPrefix, autoVoucherNo,
    postStatus, customerId, customer, paymentTotal, paymentMode, postDatedCheque,
    osAmount, newOsInTxn, allocations, paymentLines, referenceNo, receiptDate, remarks,
    chequeDetails, chequeDate, branchId, message,
  } = args;
  const voucherNo = voucherMasterId
    ? `${voucherPrefix || 'RCV'}${autoVoucherNo ?? transactionNo ?? transactionId}`
    : null;
  return {
    transactionId,
    transactionNo,
    voucherMasterId,
    voucherNo,
    postStatus: postStatus || 'PENDING',
    branchId,
    customerId,
    customerCode: customer.customer_code,
    customerName: customer.customer_name,
    referenceNo: referenceNo || null,
    receiptDate,
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

async function assertReceiptEditable(db, companyId, branchId, transactionId) {
  const receipt = await settlementRepo.getSettlementReceipt(db, companyId, branchId, transactionId);
  if (!receipt) {
    const err = new Error('Receipt not found');
    err.status = 404;
    throw err;
  }
  if (receipt.voucher?.postStatus === 'POSTED') {
    const err = new Error('Receipt is posted — unpost before editing');
    err.status = 409;
    throw err;
  }
  return receipt;
}

async function persistReceiptChildren(client, args) {
  const {
    companyId, branchId, transactionId, allocations, customerLedgerId,
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
      ledgerId: customerLedgerId,
      createdBy: auditBy,
    });
  }
}

export async function listCustomerReceiptOutstanding(authStaff, customerId, query = {}) {
  return getCustomerOutstandingBills(authStaff, customerId);
}

export async function getCustomerReceiptByVoucher(authStaff, voucherMasterId) {
  const companyId = Number(authStaff.company_id);
  const row = await settlementRepo.getCashTransactionByVoucherMasterId(pool, companyId, voucherMasterId);
  if (!row) {
    const err = new Error('Customer receipt not found for this voucher');
    err.status = 404;
    throw err;
  }
  return getCustomerReceipt(authStaff, row.transaction_id, Number(row.branch_id));
}

export async function getCustomerReceipt(authStaff, transactionId, branchIdOverride) {
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

  const receipt = await settlementRepo.getSettlementReceipt(pool, companyId, branchId, transactionId);
  if (!receipt) {
    const err = new Error('Receipt not found');
    err.status = 404;
    throw err;
  }

  let paymentLines = [];
  if (receipt.voucher?.voucherMasterId) {
    const voucher = await voucherRepo.getVoucherWithDetails(
      pool, companyId, branchId, receipt.voucher.voucherMasterId,
    );
    paymentLines = (voucher?.details || [])
      .filter((d) => num(d.debit_amount) > 0)
      .map((d) => ({
        ledgerId: Number(d.account_id),
        amount: num(d.debit_amount),
        accountNo: d.account_no,
        accountHead: d.account_head,
      }));
  }

  const postDatedCheque = Boolean(receipt.postDatedCheque)
    || String(receipt.paymentMode || '').toUpperCase() === 'CHEQUE';
  const statusFields = mapReceiptStatusFields(receipt);
  return {
    transactionId: receipt.transactionId,
    transactionNo: receipt.transactionNo,
    voucherMasterId: receipt.voucher?.voucherMasterId ?? null,
    voucherNo: receipt.voucher
      ? `${receipt.voucher.voucherPrefix || 'RCV'}${receipt.voucher.autoVoucherNo || receipt.transactionNo}`
      : receipt.receiptNo,
    postStatus: receipt.voucher?.postStatus || 'PENDING',
    branchId,
    customerId: receipt.customerId,
    customerCode: receipt.customerCode,
    customerName: receipt.customerName,
    referenceNo: receipt.voucher?.referenceNo || null,
    receiptDate: receipt.transactionDate,
    remarks: receipt.remarks,
    amount: receipt.paidAmount,
    paymentMode: receipt.paymentMode,
    postDatedCheque,
    chequeDetails: receipt.chequeDetails ?? null,
    chequeDate: receipt.chequeDate ?? null,
    ...statusFields,
    osBefore: receipt.osBefore,
    osAfter: receipt.osAfter,
    billAllocations: (receipt.clearedBills || []).map((b) => ({
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

export async function saveCustomerReceipt(authStaff, body) {
  const companyId = Number(authStaff.company_id);
  const branchId = parseBranchId(body.branchId) ?? parseBranchId(authStaff.branch_id);
  if (!branchId) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }

  const customerId = Number(body.customerId);
  const staffId = Number(authStaff.staff_id ?? authStaff.id);
  const postDatedCheque = Boolean(body.postDatedCheque);
  const chequeDetails = body.chequeDetails ? String(body.chequeDetails).trim().slice(0, 200) : null;
  const chequeDate = body.chequeDate || null;
  const receiptDate = body.receiptDate ? new Date(body.receiptDate) : new Date();
  const remarks = body.remarks ? String(body.remarks).trim().slice(0, 200) : null;
  const referenceNo = body.referenceNo ? String(body.referenceNo).trim().slice(0, 100) : null;

  if (!Number.isFinite(customerId) || customerId < 1) {
    const err = new Error('Customer is required');
    err.status = 400;
    throw err;
  }

  const { paymentLines, paymentTotal } = parsePaymentLines(body);

  const customer = await settlementRepo.getCustomerById(pool, companyId, customerId);
  if (!customer) {
    const err = new Error('Customer not found');
    err.status = 404;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const osAmount = await customerRepo.getCustomerOsBalance(client, companyId, customerId, { postedOnly: true });
    const rawBills = await settlementRepo.getOutstandingBills(client, companyId, customerId);
    const bills = settlementRepo.reconcilePostedBills(rawBills);

    if (!bills.length) {
      const err = new Error('No posted outstanding bills found for this customer — post the sale first');
      err.status = 400;
      throw err;
    }

    const allocations = buildBillAllocations(bills, body);
    await settlementRepo.assertPostedBillAllocations(client, companyId, allocations);
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
      const err = new Error(`Amount cannot exceed customer outstanding (${payableTotal.toFixed(2)})`);
      err.status = 400;
      throw err;
    }

    const customerLedgerId = await ensureCustomerLedgerForId(client, companyId, branchId, customerId);
    if (!customerLedgerId) {
      const err = new Error('Customer receivable ledger not found — create customer ledger first');
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
    let voucherPrefix = 'RCV';
    let autoVoucherNo = null;
    try {
      await client.query('SAVEPOINT customer_receipt_voucher');
      const voucherResult = await insertCustomerReceiptVoucher(client, {
        companyId,
        branchId,
        transactionId,
        customerLedgerId,
        paymentLines,
        amount: paymentTotal,
        staffId,
        customerCode: customer.customer_code,
        receiptDate,
        remarks,
        referenceNo,
        postStatus: 'PENDING',
      });
      voucherMasterId = voucherResult.voucherMasterId;
      autoVoucherNo = voucherResult.autoVoucherNo;
      voucherPrefix = (await voucherRepo.getVoucherPrefix(
        client, companyId,
        (await voucherRepo.getVoucherTypeId(client, companyId, 'ReceiptVoucherNameCustomer', branchId)) ?? 9,
      )) || 'RCV';
      await client.query('RELEASE SAVEPOINT customer_receipt_voucher');
    } catch (vErr) {
      await client.query('ROLLBACK TO SAVEPOINT customer_receipt_voucher').catch(() => {});
      if (vErr.code !== '42P01' && vErr.code !== '42703') throw vErr;
      console.warn('[backoffice] Customer receipt voucher skipped:', vErr.message);
    }

    await settlementRepo.insertCashTransactionMaster(client, {
      companyId,
      branchId,
      transactionId,
      transactionNo,
      transactionDate: receiptDate,
      counterNo: num(body.counterNo, 0) || null,
      customerId,
      amount: paymentTotal,
      totalCurrentAmount: osAmount,
      totalPaidAmount: paymentTotal,
      paymentMode,
      voucherMasterId,
      postDatedCheque,
      chequeDetails: postDatedCheque ? chequeDetails : null,
      chequeDate: postDatedCheque ? chequeDate : null,
      status: postDatedCheque ? 'PDC_PENDING' : 'DRAFT',
      remarks: remarks || `Backoffice customer receipt — ${customer.customer_code}${postDatedCheque ? ' [PDC]' : ''}`,
      createdBy: auditBy,
    });

    await persistReceiptChildren(client, {
      companyId, branchId, transactionId, allocations, customerLedgerId, postDatedCheque, auditBy,
    });

    await client.query('COMMIT');

    return mapReceiptResponse({
      transactionId,
      transactionNo,
      voucherMasterId,
      voucherPrefix,
      autoVoucherNo,
      postStatus: 'PENDING',
      customerId,
      customer,
      paymentTotal,
      paymentMode,
      postDatedCheque,
      osAmount,
      newOsInTxn: osAmount,
      allocations,
      paymentLines,
      referenceNo,
      receiptDate,
      remarks,
      chequeDetails,
      chequeDate,
      branchId,
      message: 'Customer receipt saved. Post when ready.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateCustomerReceipt(authStaff, transactionId, body) {
  const companyId = Number(authStaff.company_id);
  const branchId = parseBranchId(body.branchId) ?? parseBranchId(authStaff.branch_id);
  if (!branchId) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }

  const tid = Number(transactionId);
  const customerId = Number(body.customerId);
  const staffId = Number(authStaff.staff_id ?? authStaff.id);
  const postDatedCheque = Boolean(body.postDatedCheque);
  const chequeDetails = body.chequeDetails ? String(body.chequeDetails).trim().slice(0, 200) : null;
  const chequeDate = body.chequeDate || null;
  const receiptDate = body.receiptDate ? new Date(body.receiptDate) : new Date();
  const remarks = body.remarks ? String(body.remarks).trim().slice(0, 200) : null;
  const referenceNo = body.referenceNo ? String(body.referenceNo).trim().slice(0, 100) : null;

  const { paymentLines, paymentTotal } = parsePaymentLines(body);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await assertReceiptEditable(client, companyId, branchId, tid);

    const customer = await settlementRepo.getCustomerById(client, companyId, customerId);
    if (!customer) {
      const err = new Error('Customer not found');
      err.status = 404;
      throw err;
    }

    const osAmount = await customerRepo.getCustomerOsBalance(client, companyId, customerId, { postedOnly: true });
    const rawBills = await settlementRepo.getOutstandingBills(client, companyId, customerId);
    const bills = settlementRepo.reconcilePostedBills(rawBills);

    if (!bills.length) {
      const err = new Error('No posted outstanding bills found for this customer — post the sale first');
      err.status = 400;
      throw err;
    }

    const allocations = buildBillAllocations(bills, body);
    await settlementRepo.assertPostedBillAllocations(client, companyId, allocations);
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
      const err = new Error(`Amount cannot exceed customer outstanding (${payableTotal.toFixed(2)})`);
      err.status = 400;
      throw err;
    }

    const customerLedgerId = await ensureCustomerLedgerForId(client, companyId, branchId, customerId);
    const auditBy = String(staffId).slice(0, 50);
    const paymentMode = postDatedCheque ? 'CHEQUE' : (body.paymentMode ? String(body.paymentMode).toUpperCase() : 'CASH');
    const voucherMasterId = existing.voucher?.voucherMasterId ?? null;

    if (voucherMasterId) {
      await insertCustomerReceiptVoucher(client, {
        companyId,
        branchId,
        transactionId: tid,
        customerLedgerId,
        paymentLines,
        amount: paymentTotal,
        staffId,
        customerCode: customer.customer_code,
        receiptDate,
        remarks,
        referenceNo,
        postStatus: 'PENDING',
        voucherMasterId,
      });
    }

    await settlementRepo.updateCashTransactionMaster(client, companyId, branchId, tid, {
      amount: paymentTotal,
      totalCurrentAmount: osAmount,
      transactionDate: receiptDate,
      remarks: remarks || `Backoffice customer receipt — ${customer.customer_code}${postDatedCheque ? ' [PDC]' : ''}`,
      paymentMode,
      postDatedCheque,
      chequeDetails: postDatedCheque ? chequeDetails : null,
      chequeDate: postDatedCheque ? chequeDate : null,
      status: postDatedCheque ? 'PDC_PENDING' : 'DRAFT',
    });

    await persistReceiptChildren(client, {
      companyId, branchId, transactionId: tid, allocations, customerLedgerId, postDatedCheque, auditBy,
    });

    await client.query('COMMIT');

    return mapReceiptResponse({
      transactionId: tid,
      transactionNo: existing.transactionNo,
      voucherMasterId,
      voucherPrefix: existing.voucher?.voucherPrefix || 'RCV',
      autoVoucherNo: existing.voucher?.autoVoucherNo || existing.transactionNo,
      postStatus: 'PENDING',
      customerId,
      customer,
      paymentTotal,
      paymentMode,
      postDatedCheque,
      osAmount,
      newOsInTxn: osAmount,
      allocations,
      paymentLines,
      referenceNo,
      receiptDate,
      remarks,
      chequeDetails,
      chequeDate,
      branchId,
      message: 'Customer receipt updated.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function postCustomerReceipt(authStaff, transactionId, query = {}) {
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
    const receipt = await settlementRepo.getSettlementReceipt(client, companyId, branchId, tid);
    if (!receipt) {
      const err = new Error('Receipt not found');
      err.status = 404;
      throw err;
    }
    if (receipt.voucher?.postStatus === 'POSTED') {
      const err = new Error('Receipt is already posted');
      err.status = 409;
      throw err;
    }

    const customerId = receipt.customerId;
    const customerLedgerId = await ensureCustomerLedgerForId(client, companyId, branchId, customerId);
    const allocations = await loadReceiptAllocations(client, companyId, tid);
    const postDatedCheque = Boolean(receipt.postDatedCheque)
      || String(receipt.paymentMode || '').toUpperCase() === 'CHEQUE';

    await applyBillAllocations(client, companyId, allocations, customerLedgerId, postDatedCheque);

    if (receipt.voucher?.voucherMasterId) {
      await voucherRepo.updateVoucherPostStatus(
        client, companyId, branchId, receipt.voucher.voucherMasterId, 'POSTED',
      );
    }

    await settlementRepo.updateCashTransactionMaster(client, companyId, branchId, tid, {
      status: postDatedCheque ? 'PDC_PENDING' : 'ACTIVE',
    });

    const newOsInTxn = await customerRepo.getCustomerOsBalance(client, companyId, customerId);
    if (newOsInTxn <= 0.005) {
      await settlementRepo.syncCustomerCreditState(client, companyId, customerId, customerLedgerId);
    }

    await client.query('COMMIT');

    return {
      transactionId: tid,
      voucherMasterId: receipt.voucher?.voucherMasterId ?? null,
      postStatus: 'POSTED',
      osAfter: newOsInTxn <= 0.005 ? 0 : newOsInTxn,
      message: postDatedCheque
        ? 'PDC receipt posted — bill O/S clears when cheque is deposited/cleared.'
        : 'Customer receipt posted.',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function unpostCustomerReceipt(authStaff, transactionId, query = {}) {
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
    const receipt = await settlementRepo.getSettlementReceipt(client, companyId, branchId, tid);
    if (!receipt) {
      const err = new Error('Receipt not found');
      err.status = 404;
      throw err;
    }
    if (receipt.voucher?.postStatus !== 'POSTED') {
      const err = new Error('Receipt is not posted');
      err.status = 409;
      throw err;
    }

    const customerId = receipt.customerId;
    const customerLedgerId = await ensureCustomerLedgerForId(client, companyId, branchId, customerId);
    const allocations = await loadReceiptAllocations(client, companyId, tid);
    if (isBankReconciledStatus(receipt.status)) {
      const err = new Error('Bank-reconciled receipt cannot be unposted');
      err.status = 409;
      throw err;
    }
    const pdcPending = isPdcPendingStatus(receipt.status);
    const postDatedCheque = Boolean(receipt.postDatedCheque)
      || String(receipt.paymentMode || '').toUpperCase() === 'CHEQUE';

    await reverseBillAllocations(client, companyId, allocations, customerLedgerId, pdcPending);

    if (receipt.voucher?.voucherMasterId) {
      await voucherRepo.updateVoucherPostStatus(
        client, companyId, branchId, receipt.voucher.voucherMasterId, 'PENDING',
      );
    }

    await settlementRepo.updateCashTransactionMaster(client, companyId, branchId, tid, {
      status: postDatedCheque ? 'PDC_PENDING' : 'DRAFT',
    });

    await client.query('COMMIT');

    return {
      transactionId: tid,
      voucherMasterId: receipt.voucher?.voucherMasterId ?? null,
      postStatus: 'PENDING',
      message: 'Customer receipt unposted — you can edit and post again.',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** POST /receipts/:id/clear-pdc — cheque deposited; reduce bill O/S. */
export async function clearPdcCustomerReceipt(authStaff, transactionId, query = {}) {
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
    const receipt = await settlementRepo.getSettlementReceipt(client, companyId, branchId, tid);
    if (!receipt) {
      const err = new Error('Receipt not found');
      err.status = 404;
      throw err;
    }
    if (receipt.voucher?.postStatus !== 'POSTED') {
      const err = new Error('Receipt must be posted before clearing PDC');
      err.status = 409;
      throw err;
    }
    if (!isPdcPendingStatus(receipt.status)) {
      const err = new Error('Receipt is not pending PDC clearance');
      err.status = 409;
      throw err;
    }

    const customerId = receipt.customerId;
    const customerLedgerId = await ensureCustomerLedgerForId(client, companyId, branchId, customerId);
    const allocations = (await loadReceiptAllocations(client, companyId, tid)).map((a) => ({
      ...a,
      balance: round3(Math.max(a.currentAmount - a.paidAmount, 0)),
    }));

    await applyBillAllocations(client, companyId, allocations, customerLedgerId, false);
    await settlementRepo.updateCashTransactionChildBalances(client, companyId, tid, allocations);

    await settlementRepo.updateCashTransactionMaster(client, companyId, branchId, tid, {
      status: 'ACTIVE',
    });

    const newOsInTxn = await customerRepo.getCustomerOsBalance(client, companyId, customerId);
    if (newOsInTxn <= 0.005) {
      await settlementRepo.syncCustomerCreditState(client, companyId, customerId, customerLedgerId);
    }

    await client.query('COMMIT');

    return {
      transactionId: tid,
      receiptStatus: 'ACTIVE',
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
export async function reconcileBankCustomerReceipt(authStaff, transactionId, body = {}, query = {}) {
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
    const receipt = await settlementRepo.getSettlementReceipt(client, companyId, branchId, tid);
    if (!receipt) {
      const err = new Error('Receipt not found');
      err.status = 404;
      throw err;
    }
    if (receipt.voucher?.postStatus !== 'POSTED') {
      const err = new Error('Receipt must be posted before bank reconciliation');
      err.status = 409;
      throw err;
    }
    if (!receipt.postDatedCheque && String(receipt.paymentMode || '').toUpperCase() !== 'CHEQUE') {
      const err = new Error('Bank reconciliation applies to PDC receipts only');
      err.status = 409;
      throw err;
    }
    if (isPdcPendingStatus(receipt.status)) {
      const err = new Error('Clear PDC first before bank reconciliation');
      err.status = 409;
      throw err;
    }
    if (isBankReconciledStatus(receipt.status)) {
      const err = new Error('Receipt is already bank-reconciled');
      err.status = 409;
      throw err;
    }

    const remarks = appendBankReconRemarks(receipt.remarks, bankStatementDate, bankReference);
    await settlementRepo.updateCashTransactionMaster(client, companyId, branchId, tid, {
      status: 'BANK_RECONCILED',
      remarks,
    });

    await client.query('COMMIT');

    return {
      transactionId: tid,
      receiptStatus: 'BANK_RECONCILED',
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
