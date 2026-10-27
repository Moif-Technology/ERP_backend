/**
 * Back-office report services — parse query, call repository, map rows to the
 * exact shapes the frontend report pages render.
 */
import * as reportRepo from '../repositories/report.repository.js';
import * as dashboardRepo from '../repositories/backofficeDashboard.repository.js';
import * as voucherRepo from '../../accounts/repositories/voucher.repository.js';
import { formatAttendanceTime } from '../../hr/services/attendanceTime.js';

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function parseBranchId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.trunc(n);
}

function resolveScope(authStaff, query) {
  const companyId = Number(authStaff.company_id);
  let branchId = parseBranchId(query.branchId);
  if (branchId == null) branchId = parseBranchId(authStaff.branch_id);
  if (branchId == null) branchId = 1;
  return { companyId, branchId };
}

// branchId=all → null (every branch); otherwise as resolveScope.
function resolveBranchOrAll(authStaff, query) {
  if (String(query.branchId ?? '').toLowerCase() === 'all') return null;
  return resolveScope(authStaff, query).branchId;
}

// Optional positive integer id from the query (null when absent / invalid).
const optId = parseBranchId;

function optText(raw, max = 100) {
  const t = String(raw ?? '').trim();
  return t ? t.slice(0, max) : null;
}

const PAYMENT_MODES = new Set(['CASH', 'CARD', 'CREDIT', 'MULTI', 'OTHER']);

function salesFilters(authStaff, query) {
  const mode = String(query.paymentMode ?? '').trim().toUpperCase();
  return {
    branchId: resolveBranchOrAll(authStaff, query),
    stationId: optId(query.stationId),
    paymentMode: PAYMENT_MODES.has(mode) ? mode : null,
  };
}

function productFilters(query) {
  return {
    groupId: optId(query.groupId),
    subGroupId: optId(query.subGroupId),
    product: optText(query.product),
  };
}

const round2 = (v) => Math.round(num(v) * 100) / 100;

// Default range: first day of current month → today.
function resolveDates(query) {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(query.toDate || '') ? query.toDate : iso(today);
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(query.fromDate || '') ? query.fromDate : iso(firstOfMonth);
  return { dateFrom, dateTo };
}

// pg returns DATE/TIMESTAMP as JS Date — format to dd/MM/yyyy.
function fmtDate(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/* ───────────── SALES ───────────── */

export async function dailySales(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  let branchId;
  if (query.branchId === 'all') {
    branchId = null;
  } else {
    branchId = parseBranchId(query.branchId);
    if (branchId == null) branchId = parseBranchId(authStaff.branch_id);
    if (branchId == null) branchId = 1;
  }
  const { dateFrom, dateTo } = resolveDates(query);
  const rows = await reportRepo.dailySales(pool, companyId, branchId, dateFrom, dateTo);
  return rows.map((r) => ({
    salesId: Number(r.sales_id),
    invoiceNo: r.invoice_no || String(r.bill_no || r.sales_id),
    billNo: r.bill_no || '',
    date: fmtDate(r.bill_date),
    customer: r.customer,
    payment: r.payment_mode || 'CASH',
    sub: num(r.subtotal_amount),
    tax: num(r.tax_amount),
    disc: num(r.discount_amount),
    net: num(r.amount),
    postStatus: String(r.post_status || 'DRAFT').toUpperCase(),
  }));
}

export async function customerWiseSales(pool, authStaff, query) {
  const { companyId, branchId } = resolveScope(authStaff, query);
  const { dateFrom, dateTo } = resolveDates(query);
  const rows = await reportRepo.customerWiseSales(pool, companyId, branchId, dateFrom, dateTo);
  return rows.map((r) => ({
    customer: r.customer,
    bills: num(r.bills),
    sub: num(r.sub),
    disc: num(r.disc),
    tax: num(r.tax),
    net: num(r.net),
  }));
}

export async function productWiseSales(pool, authStaff, query) {
  const { companyId, branchId } = resolveScope(authStaff, query);
  const { dateFrom, dateTo } = resolveDates(query);
  const rows = await reportRepo.productWiseSales(pool, companyId, branchId, dateFrom, dateTo);
  return rows.map((r) => ({
    code: r.code || '',
    barcode: r.barcode || '',
    product: r.product || '',
    group: r.grp || '',
    qty: num(r.qty),
    rate: num(r.rate),
    sub: num(r.sub),
    disc: num(r.disc),
    net: num(r.net),
  }));
}

export async function salesByAgent(pool, authStaff, query) {
  const { companyId, branchId } = resolveScope(authStaff, query);
  const { dateFrom, dateTo } = resolveDates(query);
  const rows = await reportRepo.salesByAgent(pool, companyId, branchId, dateFrom, dateTo);
  return rows.map((r) => ({
    agent: r.agent,
    bills: num(r.bills),
    customers: num(r.customers),
    sub: num(r.sub),
    disc: num(r.disc),
    net: num(r.net),
    commission: Math.round(num(r.net) * 0.05 * 100) / 100, // 5% indicative commission
  }));
}

export async function salesReturn(pool, authStaff, query) {
  const { companyId, branchId } = resolveScope(authStaff, query);
  const { dateFrom, dateTo } = resolveDates(query);
  const rows = await reportRepo.salesReturn(pool, companyId, branchId, dateFrom, dateTo);
  return rows.map((r) => ({
    retNo: r.ret_no,
    date: fmtDate(r.bill_date),
    origBill: r.orig_bill || '',
    customer: r.customer,
    reason: r.reason || '',
    amount: num(r.amount),
    status: r.status,
  }));
}

export async function lookups(pool, authStaff) {
  const companyId = Number(authStaff.company_id);
  const r = await reportRepo.reportLookups(pool, companyId);
  return {
    branches: r.branches.map((b) => ({
      id: Number(b.branch_id),
      name: b.branch_name || `Branch ${b.branch_id}`,
      locationType: String(b.location_type || 'SHOP').toUpperCase(),
    })),
    stations: r.stations.map((s) => ({
      id: Number(s.station_id),
      branchId: Number(s.branch_id),
      name: s.station_name || `Station ${s.station_id}`,
      type: s.station_type || '',
    })),
    groups: r.groups.map((g) => ({ id: Number(g.group_id), name: g.group_description || `Group ${g.group_id}` })),
    subGroups: r.subGroups.map((g) => ({
      id: Number(g.sub_group_id),
      groupId: Number(g.group_id),
      name: g.sub_group_description || `Sub-group ${g.sub_group_id}`,
    })),
    suppliers: r.suppliers.map((s) => ({ id: Number(s.supplier_id), name: s.supplier_name || `Supplier ${s.supplier_id}` })),
  };
}

export async function salesSummary(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const { dateFrom, dateTo } = resolveDates(query);
  const rows = await reportRepo.salesSummary(pool, companyId, dateFrom, dateTo, salesFilters(authStaff, query));
  return rows.map((r) => {
    // Signed so column totals give Net (returns reduce sales).
    const sign = r.tx === 'RETURN' ? -1 : 1;
    return {
      salesId: Number(r.sales_id),
      invoiceNo: r.invoice_no || String(r.bill_no || r.sales_id),
      date: fmtDate(r.bill_date),
      type: r.tx === 'RETURN' ? 'Return' : 'Sale',
      branch: r.branch_name || '',
      station: r.station_name || (r.station_id == null ? 'Back Office' : `Station ${r.station_id}`),
      customer: r.customer,
      payment: r.mode,
      sub: sign * num(r.subtotal_amount),
      tax: sign * num(r.tax_amount),
      disc: sign * num(r.discount_amount),
      net: sign * num(r.amount),
      cash: sign * num(r.cash_amt),
      card: sign * num(r.card_amt),
      credit: sign * num(r.credit_amt),
      other: sign * num(r.other_amt),
    };
  });
}

export async function salesByPos(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const { dateFrom, dateTo } = resolveDates(query);
  const rows = await reportRepo.salesByPos(pool, companyId, dateFrom, dateTo, salesFilters(authStaff, query));
  return rows.map((r) => ({
    branchId: Number(r.branch_id),
    branch: r.branch_name,
    stationId: r.station_id == null ? null : Number(r.station_id),
    station: r.station_name,
    bills: num(r.bills),
    returnBills: num(r.return_bills),
    saleQty: num(r.sale_qty),
    returnQty: num(r.return_qty),
    netQty: num(r.sale_qty) - num(r.return_qty),
    gross: num(r.gross),
    returns: num(r.returns),
    net: round2(num(r.gross) - num(r.returns)),
    discount: num(r.discount),
    tax: num(r.tax),
    cash: num(r.cash),
    card: num(r.card),
    credit: num(r.credit),
    other: num(r.other),
  }));
}

export async function salesAnalysis(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const { dateFrom, dateTo } = resolveDates(query);
  const groupBy = ['product', 'category', 'subcategory'].includes(query.groupBy) ? query.groupBy : 'product';
  const limit = optId(query.top);
  const rows = await reportRepo.salesAnalysis(pool, companyId, dateFrom, dateTo, {
    branchId: resolveBranchOrAll(authStaff, query),
    stationId: optId(query.stationId),
    ...productFilters(query),
    groupBy,
    sortBy: query.sortBy === 'qty' ? 'qty' : 'amount',
    limit: limit != null ? Math.min(limit, 10000) : null,
  });
  const totalNet = rows.reduce((s, r) => s + num(r.net_amount), 0);
  return rows.map((r, i) => ({
    rank: i + 1,
    keyId: r.key_id == null ? null : Number(r.key_id),
    code: r.code || '',
    barcode: r.barcode || '',
    name: r.name || '',
    group: r.grp || '',
    subGroup: r.sub_grp || '',
    products: num(r.products),
    saleQty: num(r.sale_qty),
    returnQty: num(r.return_qty),
    netQty: num(r.net_qty),
    saleAmount: num(r.sale_amount),
    returnAmount: num(r.return_amount),
    netAmount: num(r.net_amount),
    sharePct: totalNet ? Math.round((num(r.net_amount) / totalNet) * 10000) / 100 : 0,
  }));
}

/* ───────────── PURCHASE ───────────── */

export async function purchaseSummary(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const branchId = resolveBranchOrAll(authStaff, query);
  const { dateFrom, dateTo } = resolveDates(query);
  const rows = await reportRepo.purchaseSummary(pool, companyId, branchId, dateFrom, dateTo, {
    supplierId: optId(query.supplierId),
    ...productFilters(query),
  });
  return rows.map((r) => ({
    purchaseId: Number(r.purchase_id),
    billNo: r.bill_no,
    date: fmtDate(r.purchase_date),
    branch: r.branch_name || '',
    supplierInvoiceNo: r.supplier_invoice_no || '',
    supplier: r.supplier,
    items: num(r.items),
    qty: num(r.qty),
    sub: num(r.sub),
    tax: num(r.tax),
    disc: num(r.disc),
    net: num(r.net),
  }));
}

export async function supplierWisePurchase(pool, authStaff, query) {
  const { companyId, branchId } = resolveScope(authStaff, query);
  const { dateFrom, dateTo } = resolveDates(query);
  const rows = await reportRepo.supplierWisePurchase(pool, companyId, branchId, dateFrom, dateTo);
  return rows.map((r) => ({
    supplier: r.supplier,
    bills: num(r.bills),
    items: num(r.items),
    sub: num(r.sub),
    tax: num(r.tax),
    disc: num(r.disc),
    net: num(r.net),
  }));
}

export async function purchaseByProduct(pool, authStaff, query) {
  const { companyId, branchId } = resolveScope(authStaff, query);
  const { dateFrom, dateTo } = resolveDates(query);
  const rows = await reportRepo.purchaseByProduct(pool, companyId, branchId, dateFrom, dateTo);
  return rows.map((r) => ({
    code:    r.code    ?? '',
    barcode: r.barcode ?? '',
    product: r.product ?? '',
    grp:     r.grp     ?? '',
    qty:     num(r.qty),
    rate:    num(r.rate),
    sub:     num(r.sub),
    disc:    num(r.disc),
    net:     num(r.net),
  }));
}

export async function purchaseReturn(pool, authStaff, query) {
  const { companyId, branchId } = resolveScope(authStaff, query);
  const { dateFrom, dateTo } = resolveDates(query);
  const rows = await reportRepo.purchaseReturn(pool, companyId, branchId, dateFrom, dateTo);
  return rows.map((r) => ({
    billNo:   r.bill_no  ?? '',
    date:     fmtDate(r.purchase_date),
    supplier: r.supplier ?? '',
    items:    num(r.items),
    sub:      num(r.sub),
    tax:      num(r.tax),
    disc:     num(r.disc),
    net:      num(r.net),
  }));
}

export async function outstandingLPO(pool, authStaff, query) {
  const { companyId, branchId } = resolveScope(authStaff, query);
  const rows = await reportRepo.outstandingLPO(pool, companyId, branchId);
  return rows.map((r) => ({
    lpoNo:    r.lpo_no   ?? '',
    date:     fmtDate(r.lpo_date),
    supplier: r.supplier ?? '',
    status:   r.status   ?? '',
    items:    num(r.items),
    sub:      num(r.sub),
    disc:     num(r.disc),
    net:      num(r.net),
  }));
}

/* ───────────── STOCK ───────────── */

// One row per product; byBranch = on-hand qty per branch (matrix columns when
// branchId=all). In / out / close / value are summed across the branches returned.
export async function stockSummary(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const branchId = resolveBranchOrAll(authStaff, query);
  const { dateFrom, dateTo } = resolveDates(query);
  const rows = await reportRepo.stockSummary(pool, companyId, branchId, dateFrom, dateTo, {
    supplierId: optId(query.supplierId),
    ...productFilters(query),
  });
  const byProduct = new Map();
  for (const r of rows) {
    const id = Number(r.product_id);
    let p = byProduct.get(id);
    if (!p) {
      p = {
        productId: id,
        code: r.code || '',
        barcode: r.barcode || '',
        product: r.product || '',
        group: r.grp || '',
        subGroup: r.sub_grp || '',
        supplier: r.supplier || '',
        byBranch: {},
        openQty: 0, inQty: 0, outQty: 0, closeQty: 0, stockValue: 0, costPrice: num(r.cost_price),
      };
      byProduct.set(id, p);
    }
    const closeQty = num(r.close_qty);
    const inQty = num(r.in_qty);
    const outQty = num(r.out_qty);
    p.byBranch[Number(r.branch_id)] = closeQty;
    p.inQty += inQty;
    p.outQty += outQty;
    p.closeQty += closeQty;
    p.openQty += closeQty - inQty + outQty;
    p.stockValue += num(r.stock_value);
  }
  return [...byProduct.values()].map((p) => ({
    ...p,
    stockValue: round2(p.stockValue),
    // Weighted cost across branches when there is stock.
    costPrice: p.closeQty > 0 ? round2(p.stockValue / p.closeQty) : p.costPrice,
  }));
}

export async function stockLedger(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const branchId = resolveBranchOrAll(authStaff, query);
  const { dateFrom, dateTo } = resolveDates(query);
  const productId = parseBranchId(query.productId); // optional — null = all products
  const rows = await reportRepo.stockLedger(pool, companyId, branchId, productId, dateFrom, dateTo, {
    supplierId: optId(query.supplierId),
    ...productFilters(query),
  });
  return rows.map((r) => ({
    date: fmtDate(r.date),
    branch: r.branch_name || '',
    voucher: r.voucher || '',
    type: r.type || '',
    code: r.code || '',
    barcode: r.barcode || '',
    ref: r.ref || '',
    inQty: num(r.in_qty),
    outQty: num(r.out_qty),
    balance: num(r.balance),
  }));
}

export async function reorder(pool, authStaff, query) {
  const { companyId, branchId } = resolveScope(authStaff, query);
  const rows = await reportRepo.reorder(pool, companyId, branchId);
  return rows.map((r) => {
    const currentQty = num(r.current_qty);
    const reorderPoint = num(r.reorder_point);
    return {
      code: r.code || '',
      barcode: r.barcode || '',
      product: r.product || '',
      group: r.grp || '',
      currentQty,
      reorderPoint,
      reorderQty: num(r.reorder_qty),
      supplier: r.supplier || '',
      urgent: currentQty <= reorderPoint / 2,
    };
  });
}

export async function inventoryReconciliation(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const branchId = resolveBranchOrAll(authStaff, query);
  const { dateFrom, dateTo } = resolveDates(query);
  const onlyVariance = query.onlyVariance === '1' || query.onlyVariance === 'true';
  const [rows, valuation] = await Promise.all([
    reportRepo.inventoryReconciliation(pool, companyId, branchId, dateFrom, dateTo, {
      ...productFilters(query),
      onlyVariance,
    }),
    reportRepo.stockValueVsGl(pool, companyId, branchId, dateTo),
  ]);
  return {
    period: { dateFrom, dateTo },
    rows: rows.map((r) => {
      const computedClose = num(r.opening) + num(r.purchases) + num(r.transfer_in) - num(r.transfer_out)
        - num(r.sales) + num(r.returns) + num(r.adjustments);
      // On-hand rolled back to dateTo by removing movements logged after it.
      const systemClose = num(r.on_hand) - num(r.after_qty);
      const variance = Math.round((systemClose - computedClose) * 10000) / 10000;
      return {
        branch: r.branch_name || `Branch ${r.branch_id}`,
        code: r.code || '',
        barcode: r.barcode || '',
        product: r.product || '',
        opening: num(r.opening),
        purchases: num(r.purchases),
        transferIn: num(r.transfer_in),
        transferOut: num(r.transfer_out),
        sales: num(r.sales),
        returns: num(r.returns),
        adjustments: num(r.adjustments),
        computedClose,
        systemClose,
        onHand: num(r.on_hand),
        variance,
        varianceValue: round2(variance * num(r.unit_cost)),
      };
    }),
    valuation: valuation.map((v) => ({
      branch: v.branch_name || `Branch ${v.branch_id}`,
      stockQty: num(v.stock_qty),
      stockValue: round2(v.stock_value),
      glBalance: round2(v.gl_balance),
      difference: round2(num(v.stock_value) - num(v.gl_balance)),
    })),
  };
}

export async function accountsReconciliation(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const { dateFrom, dateTo } = resolveDates(query);
  const f = { ...salesFilters(authStaff, query), paymentMode: null };
  const [bills, closes] = await Promise.all([
    reportRepo.salesVoucherReconciliation(pool, companyId, dateFrom, dateTo, f),
    reportRepo.counterCloseReconciliation(pool, companyId, dateFrom, dateTo, f),
  ]);

  const daily = new Map();
  const mismatches = [];
  for (const r of bills) {
    const sign = r.tx === 'RETURN' ? -1 : 1;
    const date = fmtDate(r.bill_date);
    const branch = r.branch_name || `Branch ${r.branch_id}`;
    const key = `${date}|${branch}`;
    let d = daily.get(key);
    if (!d) {
      d = {
        date, branch, bills: 0, cash: 0, card: 0, credit: 0, other: 0, net: 0,
        expectedVoucher: 0, postedVoucher: 0, mismatchedBills: 0,
      };
      daily.set(key, d);
    }
    const expected = num(r.expected_voucher);
    const posted = num(r.posted_voucher);
    const diff = round2(expected - posted);
    d.bills += 1;
    d.cash += sign * num(r.cash_amt);
    d.card += sign * num(r.card_amt);
    d.credit += sign * num(r.credit_amt);
    d.other += sign * num(r.other_amt);
    d.net += sign * num(r.amount);
    d.expectedVoucher += sign * expected;
    d.postedVoucher += sign * posted;
    if (Math.abs(diff) > 0.01) {
      d.mismatchedBills += 1;
      mismatches.push({
        date,
        branch,
        station: r.station_name || (r.station_id == null ? 'Back Office' : `Station ${r.station_id}`),
        billNo: r.invoice_no || String(r.bill_no || r.sales_id),
        type: r.tx === 'RETURN' ? 'Return' : 'Sale',
        source: r.entry_source || 'BACKOFFICE',
        payment: r.mode,
        amount: num(r.amount),
        expectedVoucher: expected,
        postedVoucher: posted,
        difference: diff,
        issue: posted === 0
          ? 'No voucher posted'
          : expected === 0 ? 'Voucher not expected (cash/card POS bill)' : 'Voucher amount differs',
      });
    }
  }

  const counterCloses = closes.map((c) => {
    const cashGap = round2(num(c.total_cash) - num(c.linked_cash));
    const cardGap = round2(num(c.total_card) - num(c.linked_card));
    const creditGap = round2(num(c.total_credit) - num(c.linked_credit));
    const collectedGap = round2(num(c.collected_cash) - num(c.cash_to_be_collected));
    const issues = [];
    if (Math.abs(cashGap) > 0.01) issues.push('Cash total ≠ linked bills');
    if (Math.abs(cardGap) > 0.01) issues.push('Card total ≠ linked bills');
    if (Math.abs(creditGap) > 0.01) issues.push('Credit total ≠ linked bills');
    if (Math.abs(collectedGap) > 0.01) issues.push(collectedGap < 0 ? 'Cash short' : 'Cash excess');
    return {
      closeNo: c.close_no,
      date: fmtDate(c.close_date),
      branch: c.branch_name || `Branch ${c.branch_id}`,
      station: c.station_name || (c.station_id == null ? '' : `Station ${c.station_id}`),
      counterNo: num(c.counter_no),
      billCount: num(c.bill_count),
      linkedBills: num(c.linked_bills),
      recordedCash: num(c.total_cash),
      linkedCash: round2(c.linked_cash),
      recordedCard: num(c.total_card),
      linkedCard: round2(c.linked_card),
      recordedCredit: num(c.total_credit),
      linkedCredit: round2(c.linked_credit),
      expectedCash: num(c.cash_to_be_collected),
      collectedCash: num(c.collected_cash),
      cashDifference: collectedGap,
      status: issues.length ? issues.join('; ') : 'OK',
    };
  });

  return {
    period: { dateFrom, dateTo },
    daily: [...daily.values()].map((d) => ({
      ...d,
      cash: round2(d.cash),
      card: round2(d.card),
      credit: round2(d.credit),
      other: round2(d.other),
      net: round2(d.net),
      expectedVoucher: round2(d.expectedVoucher),
      postedVoucher: round2(d.postedVoucher),
      difference: round2(d.expectedVoucher - d.postedVoucher),
    })),
    mismatches,
    counterCloses,
  };
}

// Dashboard panel: stock per store + today's sales per store / POS.
export async function liveStoreStatus(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(query.date || '') ? query.date : new Date().toISOString().slice(0, 10);
  const { stock, sales } = await dashboardRepo.getLiveStoreStatus(pool, { companyId, day });
  return {
    day,
    generatedAt: new Date().toISOString(),
    branches: stock.map((r) => ({
      branchId: Number(r.branch_id),
      branch: r.branch_name,
      products: num(r.products),
      stockQty: num(r.stock_qty),
      stockValue: round2(r.stock_value),
      lowStock: num(r.low_stock),
      zeroStock: num(r.zero_stock),
    })),
    sales: sales.map((r) => ({
      branchId: Number(r.branch_id),
      branch: r.branch_name,
      stationId: r.station_id == null ? null : Number(r.station_id),
      station: r.station_name,
      bills: num(r.bills),
      netSales: round2(r.net_sales),
      lastBillAt: r.last_bill_at,
    })),
  };
}

/* ───────────── ACCOUNTS ───────────── */

export async function customerBalance(pool, authStaff, query) {
  const { companyId, branchId } = resolveScope(authStaff, query);
  const rows = await voucherRepo.getAgingSummary(pool, companyId, { branchId, summaryType: 'receivable' });
  return rows.map((r) => ({
    customer: r.account_head,
    invoiced: num(r.total_debit),
    paid: num(r.total_credit),
    balance: num(r.outstanding),
    overdue: num(r.age_30_60) + num(r.age_60_120) + num(r.age_120_plus),
  }));
}

export async function supplierBalance(pool, authStaff, query) {
  const { companyId, branchId } = resolveScope(authStaff, query);
  const rows = await voucherRepo.getAgingSummary(pool, companyId, { branchId, summaryType: 'payable' });
  return rows.map((r) => ({
    supplier: r.account_head,
    purchased: num(r.total_credit),
    paid: num(r.total_debit),
    balance: num(r.outstanding),
    overdue: num(r.age_30_60) + num(r.age_60_120) + num(r.age_120_plus),
  }));
}

export async function cashBankMovement(pool, authStaff, query) {
  const { companyId, branchId } = resolveScope(authStaff, query);
  const { dateFrom, dateTo } = resolveDates(query);
  const rows = await reportRepo.cashBankMovement(pool, companyId, branchId, dateFrom, dateTo);
  let running = 0;
  return rows.map((r) => {
    const debit = num(r.debit);
    const credit = num(r.credit);
    running += debit - credit;
    return {
      date: fmtDate(r.date),
      voucher: r.voucher || '',
      type: r.type || '',
      account: r.account || '',
      narration: r.narration || '',
      debit,
      credit,
      balance: Math.round(running * 100) / 100,
    };
  });
}

/* ───────────── HR ───────────── */

export async function attendanceReport(pool, authStaff, query) {
  const { companyId, branchId } = resolveScope(authStaff, query);
  const { dateFrom, dateTo } = resolveDates(query);
  const rows = await reportRepo.attendanceReport(pool, companyId, branchId, dateFrom, dateTo);
  return rows.map((r) => ({
    date: fmtDate(r.work_date),
    empCode: r.employee_code || '',
    employee: r.employee_name || '',
    department: r.department || '',
    firstIn: formatAttendanceTime(r.first_in),
    lastOut: formatAttendanceTime(r.last_out),
    hours: r.hours == null ? null : num(r.hours),
    absence: r.status === 'Absent' ? 'Yes' : ['Missing', 'No Record', ''].includes(r.status || '') ? 'Unconfirmed' : 'No',
    otHours: num(r.ot_hours),
    status: r.status || '',
  }));
}

export async function leaveReport(pool, authStaff, query) {
  const { companyId, branchId } = resolveScope(authStaff, query);
  const { dateFrom, dateTo } = resolveDates(query);
  const rows = await reportRepo.leaveReport(pool, companyId, branchId, dateFrom, dateTo);
  return rows.map((r) => ({
    empCode: r.employee_code || '',
    employee: r.employee_name || '',
    department: r.department || '',
    leaveType: r.leave_type || '',
    fromDate: fmtDate(r.from_date),
    toDate: fmtDate(r.to_date),
    totalDays: num(r.total_days),
    status: r.status || '',
  }));
}
