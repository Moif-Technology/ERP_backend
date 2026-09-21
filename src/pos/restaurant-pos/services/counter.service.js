/**
 * RptCounterCloseDetailsPending — DisplayDetails + PrintSalesReportSummary (Z).
 * Counter Close ALL: every pending RESTAURANT-POS bill on this station.
 */
import { withTransaction } from '../../../config/db.js';
import * as repo from '../repositories/counter.repository.js';
import * as sharedRepo from '../../counter-pos/repositories/counter.repository.js';

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function parseCtx(authStaff, src = {}) {
  const staffPk = Number(authStaff.id ?? authStaff.staff_pk ?? authStaff.staffPk);
  const staffBiz = Number(authStaff.staff_id);
  const fromBody = num(src.stationId ?? src.StationID, 0);
  const fromAuth = num(authStaff.station_id ?? authStaff.branch_id, 0);
  const stationId = fromBody > 0 ? fromBody : fromAuth;
  const counterRaw = num(src.counterNo ?? src.gvCounterNo ?? authStaff.counter_no, 0);
  const branchId = num(authStaff.branch_id, 0) || stationId;
  return {
    companyId: num(authStaff.company_id, 0),
    branchId: branchId > 0 ? branchId : stationId,
    stationId,
    counterNo: counterRaw > 0 ? counterRaw : (stationId > 0 ? stationId : 1),
    staffId: Number.isFinite(staffPk) && staffPk > 0 ? staffPk : Number.isFinite(staffBiz) && staffBiz > 0 ? staffBiz : 1,
  };
}

function mapStaff(rows) {
  return (rows ?? []).map((r) => ({
    staffId: r.staff_id != null ? Number(r.staff_id) : null,
    staffName: r.staff_name != null ? String(r.staff_name) : 'ALL',
    billCount: num(r.bill_count),
    saleAmount: num(r.sale_amount),
    cashAmount: num(r.cash_amount),
    cardAmount: num(r.card_amount),
    creditAmount: num(r.credit_amount),
  }));
}

function mapWaiters(rows) {
  return (rows ?? []).map((r) => ({
    waiterName: r.waiter_name != null ? String(r.waiter_name) : '—',
    billCount: num(r.bill_count),
    amount: num(r.amount),
    tipAmount: num(r.tip_amount),
  }));
}

async function buildSummary(pool, ctx) {
  const [sales, cashFlow, receipts, staffRows, pendingKots, waiterRows] = await Promise.all([
    repo.getPendingSummary(pool, ctx),
    repo.getCashInOutTotals(pool, ctx),
    repo.getCreditReceiptTotals(pool, ctx),
    repo.getPendingStaffBreakdown(pool, ctx),
    repo.listPendingKots(pool, ctx),
    repo.getPendingWaiterBreakdown(pool, ctx),
  ]);
  const pendingKotCount = Array.isArray(pendingKots) ? pendingKots.length : 0;

  const totalCash = num(sales.total_cash);
  const totalCredit = num(sales.total_credit);
  const totalCard = num(sales.total_card);
  const totalOnline = num(sales.total_online);
  const totalVoucher = num(sales.total_voucher);
  const totalCompliment = num(sales.total_compliment);
  const totalDiscount = num(sales.total_discount);
  const itemDiscountTotal = num(sales.item_discount_total);
  const totalRefund = num(sales.total_refund);
  const totalTax = num(sales.total_tax);
  const totalRoundOff = num(sales.total_round_off);
  const cashIn = num(cashFlow.cash_in);
  const cashOut = num(cashFlow.cash_out);
  const creditReceiptCash = num(receipts.receipt_cash);
  const creditReceiptCard = num(receipts.receipt_card);
  const advanceReceived = 0;

  // VB: cash + credits received + advance - refund + cash in - cash out
  const cashToBeCollected =
    totalCash + creditReceiptCash + advanceReceived - totalRefund + cashIn - cashOut;

  // VB lblTotalAmount: cash + credit + card + voucher + online + other - refund
  const totalSales =
    totalCash + totalCredit + totalCard + totalVoucher + totalOnline + totalCompliment - totalRefund;

  return {
    totalCash,
    totalCredit,
    totalCard,
    totalOnline,
    totalVoucher,
    totalCompliment,
    totalDiscount,
    itemDiscountTotal,
    totalRefund,
    totalRoundOff,
    totalTax,
    totalTip: num(sales.total_tip),
    totalCashTip: num(sales.total_cash_tip),
    totalCardTip: num(sales.total_card_tip),
    totalOnlineTip: num(sales.total_online_tip),
    netCardAmount: totalCard + num(sales.total_card_tip),
    cashIn,
    cashOut,
    creditReceiptCash,
    creditReceiptCard,
    creditReceiptCount: num(receipts.receipt_count),
    advanceReceived,
    cashToBeCollected,
    totalSales,
    grossAmount: totalSales,
    billCount: num(sales.bill_count),
    cashBillCount: num(sales.cash_bill_count),
    creditBillCount: num(sales.credit_bill_count),
    cardBillCount: num(sales.card_bill_count),
    onlineBillCount: num(sales.online_bill_count),
    multiBillCount: num(sales.multi_bill_count),
    complimentBillCount: num(sales.compliment_bill_count),
    noOfCustomers: num(sales.no_of_customers),
    startBillNo: sales.start_bill_no != null ? Number(sales.start_bill_no) : null,
    endBillNo: sales.end_bill_no != null ? Number(sales.end_bill_no) : null,
    pendingKotCount: num(pendingKotCount),
    pendingKots: Array.isArray(pendingKots) ? pendingKots : [],
    startBillTime: sales.start_bill_time ?? null,
    endBillTime: sales.end_bill_time ?? null,
    staffSales: mapStaff(staffRows),
    waiterSales: mapWaiters(waiterRows),
    cashierName: 'ALL',
    counterNo: ctx.counterNo,
    stationId: ctx.stationId,
  };
}

export async function getSummary(pool, authStaff, query) {
  const ctx = parseCtx(authStaff, query);
  if (!ctx.companyId || ctx.stationId < 1) {
    const err = new Error('stationId / company context required');
    err.status = 400;
    throw err;
  }
  return buildSummary(pool, ctx);
}

export async function closeCounter(pool, authStaff, body) {
  const ctx = parseCtx(authStaff, body);
  if (!ctx.companyId || ctx.stationId < 1) {
    const err = new Error('stationId / company context required');
    err.status = 400;
    throw err;
  }
  const reportType = String(body.reportType ?? 'Z').toUpperCase();
  const collectedCash = num(body.collectedCash);
  const remarks = String(body.remarks ?? '').slice(0, 200);

  if (reportType !== 'X' && reportType !== 'Z') {
    const err = new Error('reportType must be X or Z');
    err.status = 400;
    throw err;
  }

  const summary = await buildSummary(pool, ctx);
  const cashDifference = collectedCash - summary.cashToBeCollected;

  if (reportType === 'X') {
    return { reportType: 'X', ...summary, collectedCash, cashDifference, remarks };
  }

  if (body.collectedCash == null || String(body.collectedCash).trim() === '') {
    const err = new Error('Enter Collected Amount...........');
    err.status = 400;
    throw err;
  }

  if (summary.pendingKotCount > 0) {
    const err = new Error(`${summary.pendingKotCount} KOT's Pending...........`);
    err.status = 409;
    err.code = 'PENDING_KOT';
    throw err;
  }

  if (num(summary.totalSales) === 0) {
    const err = new Error('No Sale...........');
    err.status = 400;
    throw err;
  }

  const { closeId, closeNo, billsClosed } = await withTransaction(async (client) => {
    const seq = await repo.getNextCloseSeq(client, ctx);
    const closeNo = `S${ctx.counterNo}-${seq}`;
    const closeData = {
      companyId: ctx.companyId,
      branchId: ctx.branchId > 0 ? ctx.branchId : ctx.stationId,
      stationId: ctx.stationId,
      counterNo: ctx.counterNo > 0 ? ctx.counterNo : ctx.stationId,
      staffId: ctx.staffId > 0 ? ctx.staffId : 1,
      reportType: 'Z',
      totalCash: summary.totalCash,
      totalCredit: summary.totalCredit,
      totalCard: summary.totalCard,
      totalDiscount: summary.totalDiscount,
      totalRefund: summary.totalRefund,
      totalRoundOff: summary.totalRoundOff,
      totalTax: summary.totalTax,
      grossAmount: summary.grossAmount,
      cashIn: summary.cashIn,
      cashOut: summary.cashOut,
      cashToBeCollected: summary.cashToBeCollected,
      collectedCash,
      cashDifference,
      billCount: summary.billCount,
      startBillNo: summary.startBillNo,
      endBillNo: summary.endBillNo,
      closeNo,
      creditReceiptCash: summary.creditReceiptCash,
      creditReceiptCard: summary.creditReceiptCard,
      creditReceiptCount: summary.creditReceiptCount,
    };
    const inserted = await sharedRepo.insertCounterClose(client, closeData);
    const billsClosed = await repo.markSalesAsClosed(client, { ...ctx, closeNo });
    await repo.markSplitsAsClosed(client, { ...ctx, closeNo });
    await repo.markCashInOutAsClosed(client, { ...ctx, closeId: inserted.id });
    await repo.markCreditReceiptsAsClosed(client, { ...ctx, closeNo });
    if (billsClosed < 1 && num(summary.billCount) > 0) {
      const err = new Error('Could not mark sales as closed');
      err.status = 500;
      throw err;
    }
    return { closeId: inserted.id, closeNo: inserted.closeNo || closeNo, billsClosed };
  });

  return {
    closeId,
    closeNo,
    reportType: 'Z',
    billsClosed,
    CounterClosed: 'TRUE',
    ...summary,
    collectedCash,
    cashDifference,
    remarks,
  };
}
