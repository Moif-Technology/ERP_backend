import { pool, withTransaction } from '../../../config/db.js';
import * as repo from '../repositories/counter.repository.js';

function parseBoolFlag(v) {
  if (v === true || v === 1) return true;
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'admin';
}

function parseContext(authStaff, query = {}) {
  // Salon settle writes sales_master.staff_id = staff PK (authStaff.id / JWT sub).
  // Prefer PK so non-admin close matches pending bills; fall back to business staff_id.
  const staffPk = Number(authStaff.id ?? authStaff.staff_pk ?? authStaff.staffPk);
  const staffBiz = Number(authStaff.staff_id);
  return {
    companyId: Number(authStaff.company_id),
    branchId:  Number(authStaff.branch_id),
    stationId: Number(authStaff.station_id ?? authStaff.branch_id),
    staffId:   Number.isFinite(staffPk) && staffPk > 0 ? staffPk : staffBiz,
    counterNo: Number(query.counterNo ?? 1),
    // Admin counter close: all cashiers' pending on this counter
    allStaff:  parseBoolFlag(query.allStaff ?? query.admin),
  };
}

/**
 * Build the full summary object from DB.
 * Used by both X Report (read-only) and Z Report (before closing).
 */
async function buildSummary(ctx) {
  const [sales, cashFlow, receipts, staffRows] = await Promise.all([
    repo.getPendingSummary(pool, ctx),
    repo.getCashInOutTotals(pool, ctx),
    repo.getCreditReceiptTotals(pool, ctx),
    repo.getPendingStaffBreakdown(pool, ctx),
  ]);

  const totalCash    = Number(sales.total_cash);
  const totalCredit  = Number(sales.total_credit);
  const totalCard    = Number(sales.total_card);
  const totalOnline  = Number(sales.total_online ?? 0);
  const totalVoucher = Number(sales.total_voucher ?? 0);
  const totalDiscount = Number(sales.total_discount);
  const itemDiscountTotal = Number(sales.item_discount_total ?? 0);
  const totalRefund  = Number(sales.total_refund);
  const totalRoundOff = Number(sales.total_round_off);
  const totalTax     = Number(sales.total_tax);
  const grossAmount  = Number(sales.gross_amount);
  const cashIn       = Number(cashFlow.cash_in);
  const cashOut      = Number(cashFlow.cash_out);
  const creditReceiptCash = Number(receipts.receipt_cash);
  const creditReceiptCard = Number(receipts.receipt_card);

  // Physical cash in drawer = sales cash + credit receipts (cash) + cash in - cash out - refunds
  const cashToBeCollected = totalCash + creditReceiptCash + cashIn - cashOut - totalRefund;

  return {
    totalCash,
    totalCredit,
    totalCard,
    totalOnline,
    totalVoucher,
    totalDiscount,
    itemDiscountTotal,
    totalRefund,
    totalRoundOff,
    totalTax,
    grossAmount,
    cashIn,
    cashOut,
    creditReceiptCash,
    creditReceiptCard,
    creditReceiptCount: Number(receipts.receipt_count),
    cashToBeCollected,
    billCount:       Number(sales.bill_count),
    cashBillCount:   Number(sales.cash_bill_count),
    creditBillCount: Number(sales.credit_bill_count),
    cardBillCount:   Number(sales.card_bill_count),
    multiBillCount:  Number(sales.multi_bill_count),
    complimentBillCount: Number(sales.compliment_bill_count ?? 0),
    startBillNo:  sales.start_bill_no ? Number(sales.start_bill_no) : null,
    endBillNo:    sales.end_bill_no   ? Number(sales.end_bill_no)   : null,
    staffSales: mapStaffSalesRows(staffRows),
  };
}

function mapStaffSalesRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    staffId:      r.staff_id != null ? Number(r.staff_id) : null,
    staffName:    r.staff_name != null ? String(r.staff_name) : 'Unknown',
    billCount:    Number(r.bill_count ?? 0),
    saleAmount:   Number(r.sale_amount ?? 0),
    refundAmount: Number(r.refund_amount ?? 0),
    cashAmount:   Number(r.cash_amount ?? 0),
    cardAmount:   Number(r.card_amount ?? 0),
    creditAmount: Number(r.credit_amount ?? 0),
  }));
}

function mapCashInOutRow(r) {
  return {
    id:              Number(r.id),
    transactionType: r.transaction_type,
    amount:          Number(r.amount),
    remarks:         r.remarks ?? null,
    createdAt:       r.created_at,
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
  return { ...summary, cashInOutList: cashInOutList.map(mapCashInOutRow) };
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
  const { closeId, closeNo, billsClosed } = await withTransaction(async (client) => {
    const seq = await repo.getNextCloseSeq(client, ctx.companyId);
    const closeNo = `Z-C${ctx.counterNo}-${String(seq).padStart(4, '0')}`;
    const { id } = await repo.insertCounterClose(client, { ...closeData, closeNo });
    const billsClosed = await repo.markSalesAsClosed(client, { ...ctx, closeId: id });
    await repo.markCashInOutAsClosed(client, { ...ctx, closeId: id });
    await repo.markCreditReceiptsAsClosed(client, { ...ctx, closeId: id });
    return { closeId: id, closeNo, billsClosed };
  });

  return {
    closeId, closeNo, reportType: 'Z', billsClosed,
    ...summary, collectedCash, cashDifference,
  };
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
  const rows = await repo.getCashInOutList(pool, ctx);
  return rows.map(mapCashInOutRow);
}

/**
 * GET /counter/cash-in-out/report?dateFrom&dateTo&counterNo&closeNo&limit
 */
export async function getCashInOutReport(authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const stationId = Number(authStaff.station_id ?? authStaff.branch_id);
  const today     = new Date().toISOString().slice(0, 10);
  const counterNo = query.counterNo != null && query.counterNo !== ''
    ? Number(query.counterNo)
    : null;

  const { rows, summary } = await repo.listCashInOutReport(pool, {
    companyId,
    stationId,
    counterNo,
    dateFrom: query.dateFrom || today,
    dateTo:   query.dateTo   || today,
    closeNo:  query.closeNo ?? query.counterCloseNo ?? null,
    limit:    query.limit,
  });

  const totalCashIn  = Number(summary.total_cash_in ?? 0);
  const totalCashOut = Number(summary.total_cash_out ?? 0);

  return {
    transactions: rows.map(r => ({
      id:              Number(r.id),
      transactionType: r.transaction_type,
      amount:          Number(r.amount),
      remarks:         r.remarks ?? null,
      createdAt:       r.created_at,
      counterNo:       Number(r.counter_no),
      closeStatus:     r.close_status ?? null,
      counterCloseNo:  r.counter_close_no ?? 'PENDING',
      counterCloseId:  r.counter_close_id != null ? Number(r.counter_close_id) : null,
      staffName:       r.staff_name ?? null,
    })),
    summary: {
      totalCashIn,
      totalCashOut,
      netCash:       totalCashIn - totalCashOut,
      entryCount:    Number(summary.entry_count ?? 0),
      cashInCount:   Number(summary.cash_in_count ?? 0),
      cashOutCount:  Number(summary.cash_out_count ?? 0),
    },
  };
}

function resolveCreditReceipts(r) {
  const linkedCash  = Number(r.linked_receipt_cash ?? 0);
  const linkedCard  = Number(r.linked_receipt_card ?? 0);
  const linkedCount = Number(r.linked_receipt_count ?? 0);
  const storedCash  = Number(r.credit_receipt_cash ?? 0);
  const storedCard  = Number(r.credit_receipt_card ?? 0);
  const storedCount = Number(r.credit_receipt_count ?? 0);
  if (linkedCount > 0 || linkedCash > 0 || linkedCard > 0) {
    return { creditReceiptCash: linkedCash, creditReceiptCard: linkedCard, creditReceiptCount: linkedCount };
  }
  return { creditReceiptCash: storedCash, creditReceiptCard: storedCard, creditReceiptCount: storedCount };
}

function mapCloseRow(r) {
  const receipts = resolveCreditReceipts(r);
  return {
    closeId:           Number(r.id),
    closeNo:           r.close_no ?? null,
    reportType:        r.report_type ?? 'Z',
    closeDate:         r.close_date,
    counterNo:         Number(r.counter_no),
    staffName:         r.staff_name ?? null,
    totalCash:         Number(r.total_cash),
    totalCredit:       Number(r.total_credit),
    totalCard:         Number(r.total_card),
    totalDiscount:     Number(r.total_discount ?? 0),
    totalRefund:       Number(r.total_refund ?? 0),
    totalRoundOff:     Number(r.total_round_off ?? 0),
    totalTax:          Number(r.total_tax ?? 0),
    grossAmount:       Number(r.gross_amount),
    cashIn:            Number(r.cash_in ?? 0),
    cashOut:           Number(r.cash_out ?? 0),
    cashToBeCollected: Number(r.cash_to_be_collected),
    collectedCash:     Number(r.collected_cash),
    cashDifference:    Number(r.cash_difference),
    billCount:         Number(r.bill_count),
    startBillNo:       r.start_bill_no != null ? Number(r.start_bill_no) : null,
    endBillNo:         r.end_bill_no != null ? Number(r.end_bill_no) : null,
    ...receipts,
  };
}

/**
 * GET /counter/history?counterNo=1&dateFrom=&dateTo=&limit=
 */
export async function getHistory(authStaff, query) {
  const ctx = parseContext(authStaff, query);
  const today = new Date().toISOString().slice(0, 10);
  // Viewer / admin: allStaff=true lists every cashier on the counter.
  // Default stays staff-scoped unless the client asks for all.
  const rows = await repo.getCloseHistory(pool, {
    ...ctx,
    dateFrom: query.dateFrom || today,
    dateTo:   query.dateTo   || today,
    limit:    query.limit,
    allStaff: ctx.allStaff,
  });
  return rows.map(mapCloseRow);
}

/**
 * GET /counter/history/:closeId
 */
export async function getCloseDetail(authStaff, closeId) {
  const companyId = Number(authStaff.company_id);
  const cid = Number(closeId);
  const record = await repo.getCloseById(pool, { companyId, closeId: cid });
  if (!record) {
    const e = new Error('Counter close record not found'); e.status = 404; throw e;
  }
  const receipts = await repo.getCreditReceiptTotalsForClose(pool, companyId, cid);
  const cashInOutRows = await repo.getCashInOutByCloseId(pool, { companyId, closeId: cid });
  const staffRows = await repo.getStaffBreakdownForClose(pool, {
    companyId,
    closeId: cid,
  });
  return {
    ...mapCloseRow({
      ...record,
      linked_receipt_cash:  receipts.receipt_cash,
      linked_receipt_card:  receipts.receipt_card,
      linked_receipt_count: receipts.receipt_count,
    }),
    staffSales: mapStaffSalesRows(staffRows),
    cashInOutList: cashInOutRows.map(mapCashInOutRow),
  };
}
