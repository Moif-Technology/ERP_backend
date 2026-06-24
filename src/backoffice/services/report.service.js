/**
 * Back-office report services — parse query, call repository, map rows to the
 * exact shapes the frontend report pages render.
 */
import * as reportRepo from '../repositories/report.repository.js';
import * as voucherRepo from '../../accounts/repositories/voucher.repository.js';

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
    invoiceNo: r.invoice_no || String(r.bill_no),
    billNo: r.bill_no,
    date: fmtDate(r.bill_date),
    customer: r.customer,
    payment: r.payment_mode || 'CASH',
    sub: num(r.subtotal_amount),
    tax: num(r.tax_amount),
    disc: num(r.discount_amount),
    net: num(r.amount),
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

/* ───────────── PURCHASE ───────────── */

export async function purchaseSummary(pool, authStaff, query) {
  const { companyId, branchId } = resolveScope(authStaff, query);
  const { dateFrom, dateTo } = resolveDates(query);
  const rows = await reportRepo.purchaseSummary(pool, companyId, branchId, dateFrom, dateTo);
  return rows.map((r) => ({
    billNo: r.bill_no,
    date: fmtDate(r.purchase_date),
    supplier: r.supplier,
    items: num(r.items),
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

/* ───────────── STOCK ───────────── */

export async function stockSummary(pool, authStaff, query) {
  const { companyId, branchId } = resolveScope(authStaff, query);
  const { dateFrom, dateTo } = resolveDates(query);
  const rows = await reportRepo.stockSummary(pool, companyId, branchId, dateFrom, dateTo);
  return rows.map((r) => {
    const closeQty = num(r.close_qty);
    const inQty = num(r.in_qty);
    const outQty = num(r.out_qty);
    return {
      code: r.code || '',
      product: r.product || '',
      group: r.grp || '',
      openQty: closeQty - inQty + outQty,
      inQty,
      outQty,
      closeQty,
      costPrice: num(r.cost_price),
      stockValue: num(r.stock_value),
    };
  });
}

export async function stockLedger(pool, authStaff, query) {
  const { companyId, branchId } = resolveScope(authStaff, query);
  const { dateFrom, dateTo } = resolveDates(query);
  const productId = parseBranchId(query.productId); // optional — null = all products
  const rows = await reportRepo.stockLedger(pool, companyId, branchId, productId, dateFrom, dateTo);
  return rows.map((r) => ({
    date: fmtDate(r.date),
    voucher: r.voucher || '',
    type: r.type || '',
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
