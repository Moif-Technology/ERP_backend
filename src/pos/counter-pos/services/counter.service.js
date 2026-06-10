import { pool, withTransaction } from '../../../config/db.js';
import * as repo from '../repositories/counter.repository.js';

function parseContext(authStaff, query = {}) {
  return {
    companyId: Number(authStaff.company_id),
    branchId:  Number(authStaff.branch_id),
    staffId:   Number(authStaff.staff_id),
    counterNo: Number(query.counterNo ?? 1),
  };
}

/**
 * Build the full summary object from DB.
 * Used by both X Report (read-only) and Z Report (before closing).
 */
async function buildSummary(ctx) {
  const [sales, cashFlow] = await Promise.all([
    repo.getPendingSummary(pool, ctx),
    repo.getCashInOutTotals(pool, ctx),
  ]);

  const totalCash    = Number(sales.total_cash);
  const totalCredit  = Number(sales.total_credit);
  const totalCard    = Number(sales.total_card);
  const totalDiscount = Number(sales.total_discount);
  const totalRefund  = Number(sales.total_refund);
  const totalRoundOff = Number(sales.total_round_off);
  const totalTax     = Number(sales.total_tax);
  const grossAmount  = Number(sales.gross_amount);
  const cashIn       = Number(cashFlow.cash_in);
  const cashOut      = Number(cashFlow.cash_out);

  // Physical cash in drawer = cash sales + cash received in - cash paid out - cash refunds
  const cashToBeCollected = totalCash + cashIn - cashOut - totalRefund;

  return {
    totalCash,
    totalCredit,
    totalCard,
    totalDiscount,
    totalRefund,
    totalRoundOff,
    totalTax,
    grossAmount,
    cashIn,
    cashOut,
    cashToBeCollected,
    billCount:       Number(sales.bill_count),
    cashBillCount:   Number(sales.cash_bill_count),
    creditBillCount: Number(sales.credit_bill_count),
    cardBillCount:   Number(sales.card_bill_count),
    multiBillCount:  Number(sales.multi_bill_count),
    startBillNo:  sales.start_bill_no ? Number(sales.start_bill_no) : null,
    endBillNo:    sales.end_bill_no   ? Number(sales.end_bill_no)   : null,
  };
}

/**
 * GET /counter/summary
 * Returns live pending totals. No DB writes (X Report data source).
 */
export async function getSummary(authStaff, query) {
  const ctx = parseContext(authStaff, query);
  const summary = await buildSummary(ctx);
  const cashInOutList = await repo.getCashInOutList(pool, ctx);
  return { ...summary, cashInOutList };
}

/**
 * POST /counter/close  { counterNo, collectedCash, reportType? }
 * X Report: saves a snapshot record, no sales update.
 * Z Report: saves record + marks all pending sales/cash-in-out as closed.
 */
export async function closeCounter(authStaff, body) {
  const ctx = parseContext(authStaff, body);
  const reportType   = (body.reportType ?? 'Z').toUpperCase();
  const collectedCash = Number(body.collectedCash ?? 0);

  if (reportType !== 'X' && reportType !== 'Z') {
    const e = new Error('reportType must be X or Z'); e.status = 400; throw e;
  }

  // Always re-fetch totals from DB — never trust frontend numbers
  const summary = await buildSummary(ctx);
  const cashDifference = collectedCash - summary.cashToBeCollected;

  const closeData = {
    ...ctx,
    reportType,
    ...summary,
    collectedCash,
    cashDifference,
  };

  if (reportType === 'X') {
    // X Report — read-only snapshot, nothing saved to DB
    return { reportType: 'X', ...summary, collectedCash, cashDifference };
  }

  // Z Report — full close inside a transaction
  const { closeId, closeNo } = await withTransaction(async (client) => {
    const seq = await repo.getNextCloseSeq(client, ctx.companyId);
    const closeNo = `Z-C${ctx.counterNo}-${String(seq).padStart(4, '0')}`;
    const { id } = await repo.insertCounterClose(client, { ...closeData, closeNo });
    await repo.markSalesAsClosed(client, { ...ctx, closeId: id });
    await repo.markCashInOutAsClosed(client, { ...ctx, closeId: id });
    return { closeId: id, closeNo };
  });

  return { closeId, closeNo, reportType: 'Z', ...summary, collectedCash, cashDifference };
}

/**
 * POST /counter/cash-in-out  { counterNo, transactionType, amount, remarks }
 * Add a cash in or cash out entry for the current session.
 */
export async function addCashInOut(authStaff, body) {
  const ctx = parseContext(authStaff, body);
  const { transactionType, amount, remarks } = body;

  if (!['CASH_IN', 'CASH_OUT'].includes(transactionType)) {
    const e = new Error('transactionType must be CASH_IN or CASH_OUT'); e.status = 400; throw e;
  }
  const amt = Number(amount);
  if (!amt || amt <= 0) {
    const e = new Error('amount must be a positive number'); e.status = 400; throw e;
  }

  return repo.insertCashInOut(pool, { ...ctx, transactionType, amount: amt, remarks });
}

/**
 * GET /counter/cash-in-out?counterNo=1
 * List pending cash in/out entries for the current session.
 */
export async function getCashInOutList(authStaff, query) {
  const ctx = parseContext(authStaff, query);
  return repo.getCashInOutList(pool, ctx);
}

/**
 * GET /counter/history?counterNo=1&limit=30
 */
export async function getHistory(authStaff, query) {
  const ctx = parseContext(authStaff, query);
  return repo.getCloseHistory(pool, { ...ctx, limit: Number(query.limit ?? 30) });
}

/**
 * GET /counter/history/:closeId
 */
export async function getCloseDetail(authStaff, closeId) {
  const companyId = Number(authStaff.company_id);
  const record = await repo.getCloseById(pool, { companyId, closeId: Number(closeId) });
  if (!record) {
    const e = new Error('Counter close record not found'); e.status = 404; throw e;
  }
  return record;
}
