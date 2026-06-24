import { pool } from '../../../config/db.js';
import {
  PM,
  normalizeBillPaymentMode,
  isCreditCardBillMode,
} from '../utils/paymentModes.js';
import * as customerRepo from '../repositories/customer.repository.js';
import * as settlementRepo from '../repositories/settlement.repository.js';
import * as voucherRepo from '../../../accounts/repositories/voucher.repository.js';
import * as accountsParamRepo from '../../../accounts/repositories/accountsParameter.repository.js';
import { ensureCustomerLedgerForId } from '../../../backoffice/services/partyLedger.service.js';

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function up(v) {
  return String(v ?? '').trim().toUpperCase();
}

function resolveMode(dbMode) {
  return normalizeBillPaymentMode(dbMode);
}

/** Credit customers with outstanding balance (for settlement list). */
export async function listCreditCustomers(authStaff, q, limit = 200) {
  const companyId = Number(authStaff.company_id);
  const customers = await customerRepo.searchCustomers(pool, companyId, q, limit);
  return customers
    .filter(c => resolveMode(c.paymentMode) === PM.CREDIT)
    .map(c => ({
      customerId:   c.customerId,
      customerCode: c.customerCode,
      customerName: c.customerName,
      paymentMode:  c.paymentMode ?? 'CREDIT',
      osAmount:     c.osBalance != null ? c.osBalance : (c.creditBalance ?? 0),
    }))
    .filter(c => c.osAmount > 0.005);
}

export async function getCustomerOutstandingBills(authStaff, customerId) {
  const companyId = Number(authStaff.company_id);
  const cid = Number(customerId);
  if (!Number.isFinite(cid) || cid < 1) {
    const e = new Error('Invalid customer'); e.status = 400; throw e;
  }

  const customer = await settlementRepo.getCustomerById(pool, companyId, cid);
  if (!customer) {
    const e = new Error('Customer not found'); e.status = 404; throw e;
  }

  const ledgerOs = await customerRepo.getCustomerOsBalance(pool, companyId, cid);
  const rawBills = await settlementRepo.getOutstandingBills(pool, companyId, cid);
  const bills = settlementRepo.reconcileBillsWithLedger(rawBills, ledgerOs, cid);
  const billsSum = bills.reduce((s, b) => s + num(b.currentAmount), 0);

  return {
    customerId:   cid,
    customerCode: customer.customer_code,
    customerName: customer.customer_name,
    ledgerOs,
    billsTotal:   Math.max(ledgerOs, 0),
    billsSum,
    osAmount:     Math.max(ledgerOs, 0),
    bills,
  };
}

function resolvePayableTotal(bills, ledgerOs) {
  const target = Math.max(num(ledgerOs), 0);
  if (target > 0.005) return target;
  return bills.reduce((s, b) => s + num(b.currentAmount), 0);
}

function allocateFifo(bills, paymentAmount) {
  let remaining = num(paymentAmount);
  const lines = [];

  for (const bill of bills) {
    if (remaining <= 0.005) break;
    const current = num(bill.currentAmount);
    if (current <= 0.005) continue;
    const paid = Math.min(remaining, current);
    const balance = parseFloat((current - paid).toFixed(3));
    lines.push({
      ...bill,
      paidAmount: parseFloat(paid.toFixed(3)),
      balance,
    });
    remaining = parseFloat((remaining - paid).toFixed(3));
  }

  return lines;
}

async function resolveReceiptLedger(client, companyId, branchId, paymentMode) {
  const mode = up(paymentMode);
  const primary = isCreditCardBillMode(mode)
    ? 'CODRCreditCardReceiptLedger'
    : 'CODRCashReceiptLedger';
  const fallback = isCreditCardBillMode(mode)
    ? accountsParamRepo.PARAM_DEFAULT_CARD_LEDGER
    : accountsParamRepo.PARAM_DEFAULT_CASH_LEDGER;
  let id = await accountsParamRepo.getParameterAccountId(client, companyId, branchId, primary);
  if (!id) id = await accountsParamRepo.getParameterAccountId(client, companyId, branchId, fallback);
  return id;
}

async function postReceiptVoucher(client, args) {
  const {
    companyId, branchId, transactionId, customerLedgerId, receiptLedgerId,
    amount, staffId, customerCode,
  } = args;

  const voucherTypeId =
    (await voucherRepo.getVoucherTypeId(client, companyId, 'ReceiptVoucherNameCustomer', branchId)) ?? 9;
  const voucherPrefix =
    (await voucherRepo.getVoucherPrefix(client, companyId, voucherTypeId)) || 'RCV';

  const voucherMasterId = await voucherRepo.nextVoucherMasterId(client, companyId, branchId);
  const auditBy = String(staffId ?? 'COUNTER-POS').slice(0, 50);
  const ref = `RCT-${transactionId}`;

  await voucherRepo.insertVoucherMaster(client, {
    companyId, branchId,
    voucherMasterId, voucherTypeId,
    autoVoucherNo: transactionId,
    manualVoucherNo: ref,
    voucherPrefix,
    voucherDate: new Date(),
    referenceNo: ref,
    voucherAmount: amount,
    remarks: `Credit Settlement ${customerCode} ${ref}`,
    postStatus: 'POSTED',
    creationMode: 'COUNTER-POS',
    voucherPostedId: transactionId,
    counterCloseNo: 'PENDING',
    recordStatus: 'ACTIVE',
    createdBy: auditBy,
  });

  let detailSeq = await voucherRepo.nextVoucherDetailId(client, companyId, branchId);

  await voucherRepo.insertVoucherDetail(client, {
    companyId, branchId,
    voucherDetailId: detailSeq++,
    voucherMasterId,
    accountId: receiptLedgerId,
    debitAmount: amount,
    creditAmount: 0,
    outstandingBalance: 0,
    narration: ref,
    postStatus: 'POSTED',
    recordStatus: 'ACTIVE',
    createdBy: auditBy,
  });

  await voucherRepo.insertVoucherDetail(client, {
    companyId, branchId,
    voucherDetailId: detailSeq++,
    voucherMasterId,
    accountId: customerLedgerId,
    debitAmount: 0,
    creditAmount: amount,
    outstandingBalance: 0,
    narration: ref,
    postStatus: 'POSTED',
    recordStatus: 'ACTIVE',
    createdBy: auditBy,
  });

  return voucherMasterId;
}

/** Settlement receipt history ΓÇö filter by customer and date. */
export async function listSettlementHistory(authStaff, query = {}) {
  const companyId = Number(authStaff.company_id);
  const stationId = Number(authStaff.station_id ?? authStaff.branch_id);
  return settlementRepo.listSettlementHistory(pool, companyId, stationId, {
    customerId: query.customerId || null,
    dateFrom:   query.dateFrom   || null,
    dateTo:     query.dateTo     || null,
    limit:      query.limit,
  });
}

export async function getSettlementReceipt(authStaff, transactionId) {
  const companyId = Number(authStaff.company_id);
  const stationId = Number(authStaff.station_id ?? authStaff.branch_id);
  const receipt = await settlementRepo.getSettlementReceipt(
    pool, companyId, stationId, transactionId,
  );
  if (!receipt) {
    const e = new Error('Receipt not found'); e.status = 404; throw e;
  }
  return receipt;
}

/**
 * Save credit settlement ΓÇö FIFO bill allocation + accounts.cash_transaction_* + receipt voucher.
 */
export async function saveCreditSettlement(authStaff, body) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);   // physical — for vouchers/ledgers
  const stationId = Number(authStaff.station_id ?? authStaff.branch_id); // for cash_transaction_master
  const staffId   = Number(authStaff.staff_id);
  const customerId = Number(body.customerId);
  const amount     = num(body.amount);
  const paymentMode = normalizeBillPaymentMode(body.paymentMode || PM.CASH);
  const counterNo   = Number(body.counterNo ?? 1);

  if (!Number.isFinite(customerId) || customerId < 1) {
    const e = new Error('Customer is required'); e.status = 400; throw e;
  }
  if (amount <= 0) {
    const e = new Error('Settlement amount must be greater than zero'); e.status = 400; throw e;
  }
  if (paymentMode !== PM.CASH && paymentMode !== PM.CREDITCARD) {
    const e = new Error('Payment mode must be CASH or CREDITCARD'); e.status = 400; throw e;
  }

  const customer = await settlementRepo.getCustomerById(pool, companyId, customerId);
  if (!customer) {
    const e = new Error('Customer not found'); e.status = 404; throw e;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const osAmount = await customerRepo.getCustomerOsBalance(client, companyId, customerId);
    const rawBills = await settlementRepo.getOutstandingBills(client, companyId, customerId);
    const bills = settlementRepo.reconcileBillsWithLedger(rawBills, osAmount, customerId);
    const payableTotal = resolvePayableTotal(bills, osAmount);

    if (!bills.length) {
      const e = new Error('No outstanding bills found for this customer'); e.status = 400; throw e;
    }
    if (amount > payableTotal + 0.02) {
      const e = new Error(`Amount cannot exceed outstanding (${payableTotal.toFixed(3)})`);
      e.status = 400;
      throw e;
    }

    const allocations = allocateFifo(bills, amount);
    if (!allocations.length) {
      const e = new Error('Could not allocate payment to any bill'); e.status = 400; throw e;
    }

    const customerLedgerId = await ensureCustomerLedgerForId(client, companyId, branchId, customerId);
    if (!customerLedgerId) {
      const e = new Error('Customer ledger not found'); e.status = 400; throw e;
    }

    const receiptLedgerId = await resolveReceiptLedger(client, companyId, branchId, paymentMode);
    if (!receiptLedgerId) {
      const e = new Error(`No ${paymentMode} ledger configured for this branch`); e.status = 400; throw e;
    }

    const transactionId = await settlementRepo.nextTransactionId(client, companyId);
    const transactionNo = await settlementRepo.nextTransactionNo(client, companyId, stationId);
    const childIdBase = await settlementRepo.nextTransactionChildIdBase(client, companyId, allocations.length);
    const auditBy = String(staffId).slice(0, 50);

    let voucherMasterId = null;
    try {
      await client.query('SAVEPOINT settlement_voucher');
      voucherMasterId = await postReceiptVoucher(client, {
        companyId, branchId, transactionId,
        customerLedgerId, receiptLedgerId,
        amount, staffId, customerCode: customer.customer_code,
      });
    } catch (vErr) {
      await client.query('ROLLBACK TO SAVEPOINT settlement_voucher').catch(() => {});
      if (vErr.code !== '42P01' && vErr.code !== '42703') throw vErr;
      console.warn('[counter-pos] Settlement voucher skipped:', vErr.message);
    }

    await settlementRepo.insertCashTransactionMaster(client, {
      companyId, branchId: stationId, transactionId, transactionNo,
      counterNo, customerId, amount,
      totalCurrentAmount: osAmount,
      totalPaidAmount: amount,
      paymentMode,
      voucherMasterId,
      remarks: `Counter credit settlement ΓÇö ${customer.customer_code}`,
      createdBy: auditBy,
    });

    for (let i = 0; i < allocations.length; i++) {
      const a = allocations[i];
      await settlementRepo.insertCashTransactionChild(client, {
        companyId, branchId: stationId,
        transactionChildId: childIdBase + i,
        transactionId,
        billId: a.billId,
        billDate: a.billDate,
        invoiceNo: a.invoiceNo,
        invoiceAmount: a.invoiceAmount,
        currentAmount: a.currentAmount,
        paidAmount: a.paidAmount,
        balance: a.balance,
        ledgerId: customerLedgerId,
        createdBy: auditBy,
      });

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

    const newOsInTxn = await customerRepo.getCustomerOsBalance(client, companyId, customerId);
    if (newOsInTxn <= 0.005) {
      await settlementRepo.syncCustomerCreditState(
        client, companyId, customerId, customerLedgerId,
      );
    }

    await client.query(
      `UPDATE accounts.cash_transaction_master
       SET remarks = $3, modified_on = NOW()
       WHERE company_id = $1 AND transaction_id = $2`,
      [
        companyId,
        transactionId,
        `Counter credit settlement ΓÇö ${customer.customer_code}|OSA:${newOsInTxn}`,
      ],
    );

    await client.query('COMMIT');

    const newOs = newOsInTxn <= 0.005 ? 0 : newOsInTxn;

    return {
      transactionId,
      transactionNo,
      receiptNo: `RCV-${transactionNo}`,
      voucherMasterId,
      customerId,
      customerCode: customer.customer_code,
      customerName: customer.customer_name,
      amount,
      paymentMode,
      osBefore: osAmount,
      osAfter: newOs,
      billsCleared: allocations.map(a => ({
        billId: a.billId,
        invoiceNo: a.invoiceNo,
        billDate: a.billDate,
        invoiceAmount: a.invoiceAmount,
        osBefore: a.currentAmount,
        paidAmount: a.paidAmount,
        osAfter: a.balance,
      })),
      remainingOs: newOs,
      counterNo,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
