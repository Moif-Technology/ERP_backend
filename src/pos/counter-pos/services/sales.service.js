import { pool } from '../../../config/db.js';
import * as repo from '../repositories/sales.repository.js';
import * as customerRepo from '../repositories/customer.repository.js';
import * as appParameterRepo from '../../../backoffice/repositories/appParameter.repository.js';
import * as voucherRepo from '../../../accounts/repositories/voucher.repository.js';
import * as accountsParamRepo from '../../../accounts/repositories/accountsParameter.repository.js';
import { ensureCustomerLedgerForId } from '../../../backoffice/services/partyLedger.service.js';
import {
  PM,
  normalizeBillPaymentMode,
  normalizeSplitPayMode,
  SPLIT_PAY_MODES,
  isMultiPaymentBillMode,
} from '../utils/paymentModes.js';

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function up(v) {
  return String(v ?? '').trim().toUpperCase();
}

function buildPaymentSplits(body, paymentMode, netAmount) {
  const mode = normalizeBillPaymentMode(paymentMode || PM.CASH);
  const net = num(netAmount, 0);

  if (!isMultiPaymentBillMode(mode)) {
    return [];
  }

  const raw = Array.isArray(body?.paymentSplits) ? body.paymentSplits : [];
  const norm = raw
    .map(s => ({
      payMode: normalizeSplitPayMode(s?.payMode),
      amount: num(s?.amount, 0),
      tip: num(s?.tip, 0),
      refNo: String(s?.refNo ?? '').trim(),
      creditCardTypeId: s?.creditCardTypeId != null ? Number(s.creditCardTypeId) : null,
    }))
    .filter(s => SPLIT_PAY_MODES.has(s.payMode) && s.amount > 0);

  if (!norm.length) {
    const e = new Error('MULTIPAYMENT requires paymentSplits');
    e.status = 400;
    throw e;
  }

  const sum = norm.reduce((a, s) => a + num(s.amount, 0), 0);
  const tol = 0.02;
  if (Math.abs(sum - net) > tol) {
    const e = new Error(`Split total (${sum.toFixed(3)}) must equal netAmount (${net.toFixed(3)})`);
    e.status = 400;
    throw e;
  }
  return norm;
}

/** True when this bill is a sales return (refund). */
function detectSalesReturn(body, cartItems) {
  if (body?.isReturn === true) return true;
  if (num(body?.netAmount) < 0) return true;
  if (Array.isArray(cartItems) && cartItems.length > 0) {
    return cartItems.every(it => num(it.qty) < 0);
  }
  return false;
}

function splitMixedCart(cartItems) {
  const saleLines = [];
  const returnLines = [];
  for (const it of (cartItems ?? [])) {
    if (num(it.qty) < 0) returnLines.push(it);
    else saleLines.push(it);
  }
  return { saleLines, returnLines };
}

/**
 * Returns must satisfy DB constraints (ck_sales_master_amount) which reject
 * negative header amounts. So we store returns as POSITIVE amounts/qty and mark
 * transaction_type='RETURN'. (Counter summary treats RETURN as refund.)
 */
function normalizeReturnPayload(body) {
  const cartItems = (body.cartItems ?? []).map((it) => {
    const qty = Math.abs(num(it.qty, 0));
    const unitPrice = Math.abs(num(it.unitPrice, 0));
    const vatPer = Math.abs(num(it.vatPer, 0));
    const lineSub = qty * unitPrice;
    const vatAmt = Math.abs(num(it.vatAmt, lineSub * (vatPer / 100)));
    const lineTotal = Math.abs(num(it.lineTotal, lineSub + vatAmt));
    return {
      ...it,
      qty,
      vatAmt,
      lineTotal,
      discount: num(it.discount, 0),
    }
  })

  const abs = (v) => Math.abs(num(v, 0));
  return {
    ...body,
    cartItems,
    subTotal: abs(body.subTotal),
    discountAmt: abs(body.discountAmt),
    taxableAmt: abs(body.taxableAmt),
    taxAmt: abs(body.taxAmt),
    roundOff: abs(body.roundOff),
    netAmount: abs(body.netAmount),
    paidAmount: abs(body.paidAmount ?? body.netAmount),
  }
}

/**
 * Resolve the CR-side "Sales" ledger for a credit-sale voucher. Lookup order:
 *  1. BOSalesCRLedgerCredit parameter (matches legacy ERP convention)
 *  2. DEFAULT_SALES_LEDGER parameter
 *  3. First INCOME-type account with "Sales" in the head
 *  4. DEFAULT_CASH_LEDGER parameter (last-resort offset)
 */
async function resolveSalesCrLedger(client, companyId, branchId) {
  let id = await accountsParamRepo.getParameterAccountId(client, companyId, branchId, 'BOSalesCRLedgerCredit');
  if (id) return id;
  id = await accountsParamRepo.getParameterAccountId(client, companyId, branchId, 'DEFAULT_SALES_LEDGER');
  if (id) return id;
  const { rows } = await client.query(
    `SELECT account_id
       FROM accounts.account_head_master
      WHERE company_id = $1
        AND (UPPER(COALESCE(account_type, '')) = 'INCOME' OR account_head ILIKE '%sales%')
        AND (record_status IS NULL OR TRIM(UPPER(record_status)) = 'ACTIVE')
      ORDER BY account_id ASC
      LIMIT 1`,
    [companyId],
  );
  if (rows[0]) return Number(rows[0].account_id);
  return accountsParamRepo.getParameterAccountId(
    client, companyId, branchId, accountsParamRepo.PARAM_DEFAULT_CASH_LEDGER,
  );
}

/**
 * Post a Sales Voucher for a credit bill (Tally-style two-line journal):
 *   DR Customer ledger  netAmount       (raises outstanding)
 *   CR Sales ledger     netAmount       (income ΓåÆ voucher balanced)
 *
 * Uses the common voucher / account-head / accounts-parameter repositories
 * so it stays in sync with the ERP back-office. The customer's ledger is
 * auto-provisioned on first credit sale (see ensureCustomerLedger).
 *
 * Returns the new voucher_master_id (or null when the chart of accounts is
 * unusable ΓÇö e.g. no Sales ledger exists at all).
 */
async function postCreditSaleVoucher(client, args) {
  const { companyId, branchId, salesId, customerId, netAmount, staffId } = args;

  const custAccountId = await ensureCustomerLedgerForId(client, companyId, branchId, customerId);
  if (!custAccountId) {
    console.warn(`[counter-pos] Cannot resolve customer ${customerId} ledger ΓÇö credit voucher skipped`);
    return null;
  }

  const salesLedgerId = await resolveSalesCrLedger(client, companyId, branchId);
  if (!salesLedgerId) {
    console.warn('[counter-pos] No Sales / Cash CR ledger configured ΓÇö credit voucher skipped');
    return null;
  }

  const voucherTypeId =
    (await voucherRepo.getVoucherTypeId(client, companyId, 'SalesEntryVoucherName', branchId)) ?? 1;
  const voucherPrefix =
    (await voucherRepo.getVoucherPrefix(client, companyId, voucherTypeId)) || 'SVT';

  const voucherMasterId = await voucherRepo.nextVoucherMasterId(client, companyId, branchId);
  const auditBy         = String(staffId ?? 'COUNTER-POS').slice(0, 50);
  // Counter-POS: sales_id === bill_no ΓÇö voucher numbers match the sales bill (Tally-style).
  const billNo          = Number(salesId);
  const billRef         = String(billNo);

  await voucherRepo.insertVoucherMaster(client, {
    companyId, branchId,
    voucherMasterId, voucherTypeId,
    autoVoucherNo: billNo,
    manualVoucherNo: billRef,
    voucherPrefix,
    voucherDate: new Date(),
    referenceNo: billRef,
    voucherAmount: netAmount,
    remarks: `Credit Sale ${billRef}`,
    postStatus: 'POSTED',
    creationMode: 'COUNTER-POS',
    voucherPostedId: salesId,
    counterCloseNo: 'PENDING',
    recordStatus: 'ACTIVE',
    createdBy: auditBy,
  });

  let detailSeq = await voucherRepo.nextVoucherDetailId(client, companyId, branchId);

  // DR customer ΓÇö net debit grows their outstanding (Tally semantics).
  await voucherRepo.insertVoucherDetail(client, {
    companyId, branchId,
    voucherDetailId: detailSeq++,
    voucherMasterId,
    accountId: custAccountId,
    debitAmount: netAmount,
    creditAmount: 0,
    outstandingBalance: netAmount,
    narration: `Credit Sale ${billRef}`,
    postStatus: 'POSTED',
    recordStatus: 'ACTIVE',
    createdBy: auditBy,
  });

  // CR sales ledger ΓÇö keeps the journal balanced.
  await voucherRepo.insertVoucherDetail(client, {
    companyId, branchId,
    voucherDetailId: detailSeq++,
    voucherMasterId,
    accountId: salesLedgerId,
    debitAmount: 0,
    creditAmount: netAmount,
    outstandingBalance: 0,
    narration: `Credit Sale ${billRef}`,
    postStatus: 'POSTED',
    recordStatus: 'ACTIVE',
    createdBy: auditBy,
  });

  return voucherMasterId;
}

/**
 * Save current cart as a held bill.
 * body = { cartItems, paymentMode, subTotal, discountAmt, taxableAmt, taxAmt,
 *          roundOff, netAmount, customerId, counterNo }
 */
export async function holdBill(authStaff, body) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);
  const staffId   = Number(authStaff.staff_id);
  const counterNo = Number(body.counterNo ?? 1);
  const { cartItems, recalledHoldSalesId } = body;

  if (!cartItems?.length) {
    const e = new Error('Cart is empty'); e.status = 400; throw e;
  }

  const isReturn = detectSalesReturn(body, cartItems);
  const payload = isReturn ? normalizeReturnPayload(body) : body;
  const lines = payload.cartItems;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [companyId]);

    const salesId     = await repo.getNextSalesId(client, companyId);
    const holdNo      = await repo.getNextHoldNo(client, companyId);
    const childIdBase = await repo.getNextSalesChildIdBase(client, companyId, lines.length);
    const now         = new Date();
    const taxRate     = lines[0]?.vatPer ?? 0;

    // If re-holding a recalled bill, delete the old hold first
    if (recalledHoldSalesId) {
      await repo.deleteHoldBill(client, companyId, Number(recalledHoldSalesId));
    }

    await repo.insertHoldMaster(client, {
      companyId, salesId, branchId, counterNo,
      billDate: now,
      customerId: payload.customerId ?? null,
      paymentMode: normalizeBillPaymentMode(payload.paymentMode ?? PM.CASH),
      subTotal: payload.subTotal ?? 0,
      discountAmt: payload.discountAmt ?? 0,
      taxableAmt: payload.taxableAmt ?? 0,
      taxAmt: payload.taxAmt ?? 0,
      taxRate,
      roundOff: payload.roundOff ?? 0,
      netAmount: payload.netAmount ?? 0,
      staffId, holdNo,
      prefix: isReturn ? 'R-' : 'B-',
      transactionType: isReturn ? 'RETURN' : 'SALE',
      remarks: body.remarks?.trim() || null,
    });

    await repo.insertSalesChildren(
      client, companyId, salesId, branchId, lines, childIdBase, staffId,
    );

    await client.query('COMMIT');
    return { salesId, holdNo, isReturn, message: `Bill held as H-${holdNo}` };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function buildDeliveryRemarks(body, baseRemark) {
  const parts = [];
  const base = String(baseRemark ?? body.remarks ?? '').trim();
  if (base) parts.push(base);
  if (body.deliveryAddress) parts.push(`Addr: ${String(body.deliveryAddress).trim()}`);
  if (body.deliveryPhone) parts.push(`Tel: ${String(body.deliveryPhone).trim()}`);
  return parts.length ? parts.join(' | ') : null;
}

/**
 * Save current cart as a delivery bill (pending until settlement).
 */
export async function saveDeliveryBill(authStaff, body) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);
  const staffId   = Number(authStaff.staff_id);
  const counterNo = Number(body.counterNo ?? 1);
  const { cartItems, recalledDeliverySalesId } = body;

  if (!cartItems?.length) {
    const e = new Error('Cart is empty'); e.status = 400; throw e;
  }
  if (!body.customerId) {
    const e = new Error('Customer is required for delivery'); e.status = 400; throw e;
  }
  if (!body.deliveryTime) {
    const e = new Error('Delivery time is required'); e.status = 400; throw e;
  }

  const isReturn = detectSalesReturn(body, cartItems);
  if (isReturn) {
    const e = new Error('Returns cannot be saved as delivery'); e.status = 400; throw e;
  }
  const payload = body;
  const lines = payload.cartItems;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [companyId]);

    const salesId     = await repo.getNextSalesId(client, companyId);
    const holdNo      = await repo.getNextHoldNo(client, companyId);
    const childIdBase = await repo.getNextSalesChildIdBase(client, companyId, lines.length);
    const now         = new Date();
    const taxRate     = lines[0]?.vatPer ?? 0;

    if (recalledDeliverySalesId) {
      await repo.deleteHoldBill(client, companyId, Number(recalledDeliverySalesId));
    }

    await repo.insertDeliveryMaster(client, {
      companyId, salesId, branchId, counterNo,
      billDate: now,
      customerId: payload.customerId,
      paymentMode: 'PENDING',
      subTotal: payload.subTotal ?? 0,
      discountAmt: payload.discountAmt ?? 0,
      taxableAmt: payload.taxableAmt ?? 0,
      taxAmt: payload.taxAmt ?? 0,
      taxRate,
      roundOff: payload.roundOff ?? 0,
      netAmount: payload.netAmount ?? 0,
      staffId, holdNo,
      prefix: 'B-',
      transactionType: 'SALE',
      deliveryTime: body.deliveryTime,
      remarks: buildDeliveryRemarks(body, body.remarks),
    });

    await repo.insertSalesChildren(
      client, companyId, salesId, branchId, lines, childIdBase, staffId,
    );

    await client.query('COMMIT');
    return { salesId, holdNo, message: `Delivery saved as D-${holdNo}` };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getDeliveryBills(authStaff) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);
  return repo.getDeliveryBills(pool, companyId, branchId);
}

export async function recallDeliveryBill(authStaff, salesId) {
  const companyId = Number(authStaff.company_id);
  const items = await repo.getDeliveryBillItems(pool, companyId, Number(salesId));
  if (!items.length) {
    const e = new Error('Delivery bill not found'); e.status = 404; throw e;
  }
  return items;
}

export async function cancelDelivery(authStaff, salesId) {
  const companyId = Number(authStaff.company_id);
  const count = await repo.cancelDeliveryBill(pool, companyId, Number(salesId));
  if (!count) {
    const e = new Error('Delivery bill not found or already cancelled'); e.status = 404; throw e;
  }
  return { message: 'Delivery bill cancelled' };
}

/** Settle one pending delivery ΓåÆ posted invoice */
async function settleOneDelivery(client, authStaff, salesId, body, counterNo) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);
  const staffId   = Number(authStaff.staff_id);
  const sid = Number(salesId);

  const items = await repo.getDeliveryBillItems(client, companyId, sid);
  if (!items.length) {
    const e = new Error(`Delivery D-${sid} not found`); e.status = 404; throw e;
  }

  const { rows } = await client.query(
    `SELECT amount, customer_id
     FROM ops.sales_master
     WHERE company_id = $1 AND sales_id = $2 AND hold_status = 'DELIVERY'`,
    [companyId, sid],
  );
  if (!rows.length) {
    const e = new Error(`Delivery D-${sid} not found`); e.status = 404; throw e;
  }

  const net = Number(rows[0].amount ?? 0);
  const customerId = rows[0].customer_id;
  let paymentMode = normalizeBillPaymentMode(body.paymentMode ?? PM.CREDITCARD);

  const paid = Number(body.paidAmount ?? net);
  const balance = Number(body.balanceAmount ?? paid - net);

  if (paymentMode === 'CASH' && paid < net - 0.02) {
    const e = new Error(`Delivery D-${body.holdNo ?? sid}: paid must be at least ${net.toFixed(2)}`);
    e.status = 400;
    throw e;
  }
  if (paymentMode === 'CREDIT' && !customerId) {
    const e = new Error(`Delivery D-${body.holdNo ?? sid}: customer required for credit`);
    e.status = 400;
    throw e;
  }

  const splits = buildPaymentSplits(body, paymentMode, net);
  if (isMultiPaymentBillMode(paymentMode) && !splits.length) {
    const e = new Error(`Delivery D-${body.holdNo ?? sid}: add split payment rows`);
    e.status = 400;
    throw e;
  }
  if (isMultiPaymentBillMode(paymentMode)) {
    const billTotal = splits.reduce((a, s) => a + num(s.amount, 0), 0);
    if (Math.abs(billTotal - net) > 0.02) {
      const e = new Error(`Delivery D-${body.holdNo ?? sid}: split total must match ${net.toFixed(2)}`);
      e.status = 400;
      throw e;
    }
  }

  const cashSplit = splits.filter(s => s.payMode === 'CASH').reduce((a, s) => a + num(s.amount, 0), 0);
  const cardSplit = splits.filter(s => s.payMode === PM.CREDITCARD).reduce((a, s) => a + num(s.amount, 0), 0);
  const onlineSplit = splits.filter(s => s.payMode === 'ONLINE').reduce((a, s) => a + num(s.amount, 0), 0);
  const creditSplit = splits.filter(s => s.payMode === 'CREDIT').reduce((a, s) => a + num(s.amount, 0), 0);

  const settlePaid = isMultiPaymentBillMode(paymentMode) ? net : paid;
  const settleBalance = isMultiPaymentBillMode(paymentMode) ? 0 : balance;

  const updated = await repo.settleDeliveryMaster(client, {
    companyId,
    salesId: sid,
    paymentMode,
    paidAmount: settlePaid,
    balanceAmount: settleBalance,
    netAmount: net,
    cashAmount: isMultiPaymentBillMode(paymentMode) ? cashSplit : undefined,
    cardAmount: isMultiPaymentBillMode(paymentMode) ? (cardSplit + onlineSplit) : undefined,
    creditAmount: isMultiPaymentBillMode(paymentMode) ? creditSplit : undefined,
  });
  if (!updated) {
    const e = new Error(`Delivery D-${body.holdNo ?? sid} not found`); e.status = 404; throw e;
  }

  if (isMultiPaymentBillMode(paymentMode) && splits.length > 0) {
    await repo.insertPaymentSplits(client, {
      companyId, salesId: sid, branchId, counterNo, staffId, billDate: new Date(),
      splits,
    });
  }

  const creditOs = paymentMode === PM.CREDIT
    ? net
    : (isMultiPaymentBillMode(paymentMode) ? creditSplit : 0);
  if (creditOs > 0.005 && customerId) {
    try {
      await client.query('SAVEPOINT delivery_credit_voucher');
      await postCreditSaleVoucher(client, {
        companyId, branchId, salesId: sid,
        customerId: Number(customerId),
        netAmount: creditOs,
        staffId,
      });
      await client.query('RELEASE SAVEPOINT delivery_credit_voucher');
    } catch (vErr) {
      await client.query('ROLLBACK TO SAVEPOINT delivery_credit_voucher').catch(() => {});
      if (vErr.code !== '42P01' && vErr.code !== '42703') throw vErr;
    }
  }

  return {
    salesId: sid,
    holdNo: body.holdNo ?? null,
    billNoDisplay: `B-${sid}`,
    netAmount: net,
    paidAmount: settlePaid,
    balanceAmount: settleBalance,
  };
}

/** Collect payment and post a pending delivery bill */
export async function settleDeliveryBill(authStaff, salesId, body) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await settleOneDelivery(
      client, authStaff, salesId, body, Number(body.counterNo ?? 1),
    );
    await client.query('COMMIT');
    return { ...result, message: `Invoice ${result.billNoDisplay} posted` };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Bulk settle ΓÇö each selected delivery becomes a posted invoice */
export async function settleDeliveryBulk(authStaff, body) {
  const items = body.items ?? [];
  if (!items.length) {
    const e = new Error('Select at least one delivery'); e.status = 400; throw e;
  }

  const counterNo = Number(body.counterNo ?? 1);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [Number(authStaff.company_id)]);

    const results = [];
    for (const item of items) {
      const r = await settleOneDelivery(client, authStaff, item.salesId, item, counterNo);
      results.push(r);
    }

    await client.query('COMMIT');
    return {
      results,
      count: results.length,
      message: `${results.length} delivery invoice(s) posted`,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** List all active held bills for this branch */
export async function getHeldBills(authStaff) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);
  return repo.getHeldBills(pool, companyId, branchId);
}

/** Get master + items for one held bill */
export async function recallBill(authStaff, salesId) {
  const companyId = Number(authStaff.company_id);
  const items = await repo.getHeldBillItems(pool, companyId, Number(salesId));
  if (!items.length) {
    const e = new Error('Hold bill not found'); e.status = 404; throw e;
  }
  return items;
}

/** Cancel a held bill */
export async function cancelHold(authStaff, salesId) {
  const companyId = Number(authStaff.company_id);
  const count = await repo.cancelHoldBill(pool, companyId, Number(salesId));
  if (!count) {
    const e = new Error('Hold bill not found or already cancelled'); e.status = 404; throw e;
  }
  return { message: 'Hold bill cancelled' };
}

function formatBillNoDisplay(prefix, salesId) {
  const p = prefix ?? 'B-';
  return `${p}${salesId}`;
}

function resolveCounterCloseNo(row) {
  if (row.counter_close_no != null) return String(row.counter_close_no);
  const st = String(row.counter_close_status ?? '').trim();
  if (!st || st === 'PENDING') return 'PENDING';
  return st;
}

/** Sales viewer ΓÇö posted bills for counter with date/customer filters */
export async function listSalesViewer(authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);
  const counterNo = Number(query.counterNo ?? 1);
  const today     = new Date().toISOString().slice(0, 10);
  const dateFrom  = query.dateFrom || today;
  const dateTo    = query.dateTo   || today;
  const customerId = query.customerId != null && query.customerId !== ''
    ? Number(query.customerId)
    : null;

  const rows = await repo.listPostedSales(pool, {
    companyId,
    branchId,
    counterNo,
    dateFrom,
    dateTo,
    customerId,
    limit: query.limit,
  });

  return rows.map(r => ({
    salesId:         Number(r.sales_id),
    billNo:          Number(r.bill_no),
    billNoDisplay:   formatBillNoDisplay(r.prefix, r.sales_id),
    billDate:        r.bill_date,
    billTime:        r.bill_time ?? r.bill_date,
    paymentMode:     normalizeBillPaymentMode(r.payment_mode ?? PM.CASH),
    customerId:      r.customer_id != null ? Number(r.customer_id) : null,
    customerCode:    r.customer_code ?? null,
    customerName:    r.customer_name ?? 'Walk-in',
    amount:          Number(r.amount),
    remarks:         r.remarks?.trim() || null,
    counterCloseNo:  resolveCounterCloseNo(r),
  }));
}

/** Sales viewer ΓÇö single bill with line items */
export async function getSalesViewerBill(authStaff, salesId) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);
  const detail = await repo.getPostedBillDetail(pool, companyId, branchId, Number(salesId));
  if (!detail) {
    const e = new Error('Bill not found');
    e.status = 404;
    throw e;
  }

  const m = detail.master;
  const paymentMode = normalizeBillPaymentMode(m.payment_mode ?? PM.CASH);
  const customerId = m.customer_id != null ? Number(m.customer_id) : null;

  let customerOsBalance = 0;
  if (customerId && paymentMode === PM.CREDIT) {
    customerOsBalance = await customerRepo.getCustomerOsBalance(pool, companyId, customerId);
  }

  const taxRegistrationNo = await appParameterRepo.resolveTaxRegistrationNo(pool, companyId, branchId);

  return {
    salesId:        Number(m.sales_id),
    billNo:         Number(m.bill_no),
    billNoDisplay:  formatBillNoDisplay(m.prefix, m.sales_id),
    billDate:       m.bill_date,
    billTime:       m.bill_time ?? m.bill_date,
    paymentMode,
    counterNo:      Number(m.counter_no),
    company: {
      companyName:    m.company_name ?? null,
      companyAddress: m.company_address ?? null,
      companyPhone:   m.company_phone ?? null,
      branchName:     m.branch_name ?? null,
      taxRegistrationNo: taxRegistrationNo ?? null,
    },
    customer: {
      customerId,
      customerCode: m.customer_code ?? null,
      customerName: m.customer_name ?? 'Walk-in',
      address:      m.customer_address ?? null,
      taxRegNo:     m.customer_tax_reg_no ?? null,
      mobileNo:     m.customer_mobile ?? null,
      telephone:    m.customer_telephone ?? null,
    },
    customerOsBalance,
    staffName:      m.staff_name ?? null,
    subTotal:       Number(m.subtotal_amount),
    discountAmt:    Number(m.discount_amount),
    taxableAmt:     Number(m.taxable_amount),
    taxAmt:         Number(m.tax_1_amount),
    taxRate:        Number(m.tax_1_rate),
    roundOff:       Number(m.round_off_adjustment),
    amount:         Number(m.amount),
    paidAmount:     Number(m.paid_amount),
    balanceAmount:  Number(m.balance_paid),
    cashAmount:     Number(m.cash_amount),
    creditAmount:   Number(m.credit_amount),
    cardAmount:     Number(m.credit_card_amount),
    outstandingBalance: Number(m.outstanding_balance),
    remarks:        m.remarks ?? null,
    transactionType: m.transaction_type ?? 'SALE',
    counterCloseNo: resolveCounterCloseNo(m),
    items: detail.items.map(it => ({
      salesChildId:  Number(it.sales_child_id),
      productId:     it.product_id != null ? Number(it.product_id) : null,
      productCode:   it.product_code ?? '',
      description:   it.short_description ?? '',
      qty:           Number(it.qty),
      unitPrice:     Number(it.unit_price),
      discount:      Number(it.discount_amount),
      subTotal:      Number(it.subtotal_amount),
      vatAmt:        Number(it.tax_1_amount),
      vatPer:        Number(it.tax_1_rate),
      lineTotal:     Number(it.line_total),
    })),
    paymentSplits: detail.splits.map(s => ({
      payerNo:  Number(s.payer_no),
      payMode:  s.pay_mode,
      amount:   Number(s.bill_amount),
      tip:      Number(s.tip_amount ?? 0),
      refNo:    s.ref_no ?? '',
    })),
  };
}

/** Staff-wise sales report for the current pending counter session */
export async function getStaffWiseReport(authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);
  const counterNo = Number(query.counterNo ?? 1);
  const rows = await repo.getStaffWiseSales(pool, { companyId, branchId, counterNo });
  return rows.map(r => ({
    staffId:      r.staff_id,
    staffName:    r.staff_name ?? `Staff #${r.staff_id}`,
    billCount:    Number(r.bill_count),
    grossAmount:  Number(r.gross_amount),
    totalDiscount:Number(r.total_discount),
    totalRoundOff:Number(r.total_round_off),
    netAmount:    Number(r.net_amount),
    totalCash:    Number(r.total_cash),
    totalCard:    Number(r.total_card),
    totalCredit:  Number(r.total_credit),
  }));
}

export async function getNextBillNo(authStaff) {
  const companyId = Number(authStaff.company_id);
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(bill_no), 0) + 1 AS next_bill
     FROM ops.sales_master
     WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].next_bill);
}

/**
 * Save a POS bill inside a single DB transaction.
 * body = {
 *   cartItems: [{ productId, productCode, description, qty, unitPrice, vatPer, vatAmt, lineTotal, discount }],
 *   paymentMode: 'CASH'|'CREDITCARD'|'CREDIT'|'MULTIPAYMENT',
 *   subTotal, discountAmt, taxableAmt, taxAmt, roundOff, netAmount,
 *   paidAmount, balanceAmount,
 *   customerId: null | number,
 * }
 */
export async function saveBill(authStaff, body) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);
  const staffId   = Number(authStaff.staff_id);
  const counterNo = Number(body.counterNo ?? 1);

  const {
    cartItems, paymentMode,
    subTotal, discountAmt, taxableAmt, taxAmt, roundOff, netAmount,
    paidAmount, balanceAmount, customerId,
    recalledHoldSalesId,   // pass this if finalising a recalled hold
    recalledDeliverySalesId,
    remarks,
  } = body;

  if (!cartItems?.length) {
    const e = new Error('Cart is empty'); e.status = 400; throw e;
  }

  const { saleLines, returnLines } = splitMixedCart(cartItems);
  const isMixed = saleLines.length > 0 && returnLines.length > 0;
  const isReturn = !isMixed && detectSalesReturn(body, cartItems);

  if (isMixed && String(paymentMode || '').toUpperCase() === 'CREDIT') {
    const e = new Error('Cannot mix Return + Sale in CREDIT mode. Use CASH/CREDITCARD.');
    e.status = 400;
    throw e;
  }

  const payload = isReturn ? normalizeReturnPayload(body) : body;
  const lines = payload.cartItems;
  const net = num(payload.netAmount);
  const paid = num(payload.paidAmount, net);
  const billPaymentMode = normalizeBillPaymentMode(paymentMode);
  const splits = buildPaymentSplits(payload, billPaymentMode, net);
  const cashSplit = splits.filter(s => s.payMode === 'CASH').reduce((a, s) => a + num(s.amount, 0), 0);
  const cardSplit = splits.filter(s => s.payMode === PM.CREDITCARD).reduce((a, s) => a + num(s.amount, 0), 0);
  const onlineSplit = splits.filter(s => s.payMode === 'ONLINE').reduce((a, s) => a + num(s.amount, 0), 0);
  const creditSplit = splits.filter(s => s.payMode === 'CREDIT').reduce((a, s) => a + num(s.amount, 0), 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock to serialise concurrent bill inserts for same company
    await client.query(
      `SELECT pg_advisory_xact_lock($1)`,
      [companyId],
    );

    const now = new Date();

    const saveOne = async ({ transactionType, prefix, items, header }) => {
      const salesId = await repo.getNextSalesId(client, companyId);
      const childIdBase = await repo.getNextSalesChildIdBase(client, companyId, items.length);
      const taxRate = items[0]?.vatPer ?? 0;

      await repo.insertSalesMaster(client, {
        companyId, salesId, branchId, counterNo,
        billDate: now,
        customerId: customerId ?? null,
        paymentMode: billPaymentMode,
        subTotal: num(header.subTotal),
        discountAmt: num(header.discountAmt),
        taxableAmt: num(header.taxableAmt),
        taxAmt: num(header.taxAmt),
        taxRate,
        roundOff: num(header.roundOff),
        netAmount: num(header.netAmount),
        paidAmount: num(header.paidAmount),
        balanceAmount: num(header.paidAmount) - num(header.netAmount),
        cashAmount: isMultiPaymentBillMode(billPaymentMode) ? cashSplit : undefined,
        cardAmount: isMultiPaymentBillMode(billPaymentMode) ? (cardSplit + onlineSplit) : undefined,
        creditAmount: isMultiPaymentBillMode(billPaymentMode) ? creditSplit : undefined,
        staffId,
        prefix,
        transactionType,
        remarks: remarks?.trim() || null,
      });

      await repo.insertSalesChildren(
        client, companyId, salesId, branchId,
        items, childIdBase, staffId,
      );

      if (isMultiPaymentBillMode(billPaymentMode) && splits.length > 0) {
        await repo.insertPaymentSplits(client, {
          companyId, salesId, branchId, counterNo, staffId, billDate: now,
          splits,
        });
      }

      return salesId;
    };

    let saleSalesId = null;
    let returnSalesId = null;

    if (isMixed) {
      // SALE part (positive header, positive qty lines)
      const saleNet = saleLines.reduce((s, it) => s + Math.abs(num(it.lineTotal, num(it.qty) * num(it.unitPrice))), 0);
      const saleTax = saleLines.reduce((s, it) => s + Math.abs(num(it.vatAmt, 0)), 0);
      const saleSub = saleLines.reduce((s, it) => s + Math.abs(num(it.qty) * num(it.unitPrice)), 0);

      // RETURN part (stored positive, tx=RETURN)
      const returnPayload = normalizeReturnPayload({ ...body, cartItems: returnLines });
      const returnNet = num(returnPayload.netAmount, returnLines.length ? Math.abs(num(body.netAmount)) : 0);

      saleSalesId = await saveOne({
        transactionType: 'SALE',
        prefix: 'B-',
        items: saleLines.map(it => ({ ...it, qty: Math.abs(num(it.qty, 0)), vatAmt: Math.abs(num(it.vatAmt, 0)), lineTotal: Math.abs(num(it.lineTotal, 0)) })),
        header: {
          subTotal: saleSub,
          discountAmt: 0,
          taxableAmt: saleSub,
          taxAmt: saleTax,
          roundOff: 0,
          netAmount: saleNet || (saleSub + saleTax),
          paidAmount: saleNet || (saleSub + saleTax),
        },
      });

      returnSalesId = await saveOne({
        transactionType: 'RETURN',
        prefix: 'R-',
        items: returnPayload.cartItems,
        header: {
          subTotal: num(returnPayload.subTotal),
          discountAmt: num(returnPayload.discountAmt),
          taxableAmt: num(returnPayload.taxableAmt),
          taxAmt: num(returnPayload.taxAmt),
          roundOff: num(returnPayload.roundOff),
          netAmount: num(returnPayload.netAmount),
          paidAmount: num(returnPayload.paidAmount, num(returnPayload.netAmount)),
        },
      });
    } else {
      const salesId = await saveOne({
        transactionType: isReturn ? 'RETURN' : 'SALE',
        prefix: isReturn ? 'R-' : 'B-',
        items: lines,
        header: {
          subTotal: num(payload.subTotal),
          discountAmt: num(payload.discountAmt),
          taxableAmt: num(payload.taxableAmt),
          taxAmt: num(payload.taxAmt),
          roundOff: num(payload.roundOff),
          netAmount: net,
          paidAmount: paid,
        },
      });
      saleSalesId = salesId;
    }

    // If this bill was recalled from hold/delivery, remove the pending record
    if (recalledHoldSalesId) {
      await repo.deleteHoldBill(client, companyId, Number(recalledHoldSalesId));
    }
    if (recalledDeliverySalesId) {
      await repo.deleteHoldBill(client, companyId, Number(recalledDeliverySalesId));
    }

    // Credit-sale accounting voucher (DR customer / CR sales-ledger).
    const creditOs = billPaymentMode === PM.CREDIT
      ? net
      : (isMultiPaymentBillMode(billPaymentMode) ? creditSplit : 0);
    let creditVoucherId = null;
    if (!isMixed && !isReturn && creditOs > 0.005 && customerId != null) {
      try {
        await client.query('SAVEPOINT credit_voucher');
        creditVoucherId = await postCreditSaleVoucher(client, {
          companyId, branchId, salesId: saleSalesId,
          customerId: Number(customerId),
          netAmount: creditOs,
          staffId,
        });
        await client.query('RELEASE SAVEPOINT credit_voucher');
      } catch (vErr) {
        await client.query('ROLLBACK TO SAVEPOINT credit_voucher').catch(() => {});
        if (vErr.code === '42P01' || vErr.code === '42703') {
          console.warn('[counter-pos] Voucher tables missing ΓÇö credit OS not posted');
        } else {
          console.error('[counter-pos] Credit voucher post failed:', vErr.message);
        }
      }
    }

    await client.query('COMMIT');

    if (isMixed) {
      return {
        isMixed: true,
        sale:   { salesId: saleSalesId,   billNo: saleSalesId,   billNoDisplay: `B-${saleSalesId}` },
        return: { salesId: returnSalesId, billNo: returnSalesId, billNoDisplay: `R-${returnSalesId}` },
      };
    }

    return {
      salesId: saleSalesId,
      billNo: saleSalesId,
      billNoDisplay: `${isReturn ? 'R' : 'B'}-${saleSalesId}`,
      isReturn,
      creditVoucherId,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
