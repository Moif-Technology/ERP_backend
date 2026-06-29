import * as repo from '../repositories/backofficeDashboard.repository.js';

const num = (value) => Number(value || 0);

function money(value) {
  return Number(num(value).toFixed(3));
}

function parseDate(value, fallback) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return fallback;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? fallback : text;
}

export async function getBackofficeDashboard(pool, authStaff, query = {}) {
  const companyId = Number(authStaff.company_id);
  const branchId = Number(authStaff.branch_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid session company');
    err.status = 401;
    throw err;
  }

  const today = new Date();
  const defaultTo = today.toISOString().slice(0, 10);
  const fromDate = new Date(today);
  fromDate.setUTCDate(fromDate.getUTCDate() - 29);
  const defaultFrom = fromDate.toISOString().slice(0, 10);
  const dateFrom = parseDate(query.dateFrom || query.from, defaultFrom);
  const dateTo = parseDate(query.dateTo || query.to, defaultTo);
  if (dateFrom > dateTo) {
    const err = new Error('dateFrom cannot be after dateTo');
    err.status = 400;
    throw err;
  }
  const daySpan = Math.floor((new Date(`${dateTo}T00:00:00Z`) - new Date(`${dateFrom}T00:00:00Z`)) / 86400000) + 1;
  if (daySpan > 366) {
    const err = new Error('Dashboard date range cannot exceed 366 days');
    err.status = 400;
    throw err;
  }

  const [summary, recentRows, monthlyRows, topProductRows, weeklyRows] = await Promise.all([
    repo.getSummary(pool, { companyId, branchId, dateFrom, dateTo }),
    repo.getRecentSales(pool, { companyId, branchId, dateFrom, dateTo, limit: 5 }),
    repo.getSalesTrend(pool, { companyId, branchId, dateFrom, dateTo }),
    repo.getTopProducts(pool, { companyId, branchId, dateFrom, dateTo, limit: 5 }),
    repo.getDailySalesTrend(pool, { companyId, branchId, dateFrom, dateTo }),
  ]);

  return {
    period: { dateFrom, dateTo, days: daySpan },
    today: {
      billCount: num(summary.todaySales.bill_count),
      netSales: money(summary.todaySales.net_sales),
      cashSales: money(summary.todaySales.cash_sales),
      cardSales: money(summary.todaySales.card_sales),
    },
    setup: {
      products: num(summary.products.total_products),
      productsMissingBarcode: num(summary.products.missing_barcodes),
      customers: num(summary.customers.total_customers),
      staff: num(summary.staff.total_staff),
      staffWithPin: num(summary.staff.staff_with_pin),
      devices: num(summary.devices.total_devices),
      activeDevices: num(summary.devices.active_devices),
      lowStockItems: num(summary.lowStock.low_stock_items),
    },
    counter: {
      pendingBills: num(summary.pendingCounter.pending_bills),
      pendingAmount: money(summary.pendingCounter.pending_amount),
      lastClose: summary.lastClose.close_date ? {
        closeNo: summary.lastClose.close_no,
        counterNo: num(summary.lastClose.counter_no),
        closeDate: summary.lastClose.close_date,
        collectedCash: money(summary.lastClose.collected_cash),
        cashDifference: money(summary.lastClose.cash_difference),
      } : null,
    },
    recentSales: recentRows.map((row) => ({
      salesId: num(row.sales_id),
      billNo: row.bill_no ?? row.sales_id,
      billDate: row.bill_date,
      counterNo: num(row.counter_no),
      paymentMode: row.payment_mode,
      amount: money(row.amount),
      staffName: row.staff_name || `Staff ${row.staff_id || ''}`.trim(),
    })),
    monthlySales: monthlyRows.map((row) => ({
      label: row.label,
      bills: num(row.bills),
      sales: money(row.sales),
    })),
    topProducts: topProductRows.map((row) => ({
      product: row.product,
      qty: num(row.qty),
      amount: money(row.amount),
    })),
    weeklySales: weeklyRows.map((row) => ({
      label: row.label,
      date: row.day,
      bills: num(row.bills),
      sales: money(row.sales),
      returns: money(row.returns),
    })),
  };
}
