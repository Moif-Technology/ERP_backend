import * as repo from '../repositories/backofficeDashboard.repository.js';

const num = (value) => Number(value || 0);

function money(value) {
  return Number(num(value).toFixed(3));
}

export async function getBackofficeDashboard(pool, authStaff) {
  const companyId = Number(authStaff.company_id);
  const branchId = Number(authStaff.branch_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid session company');
    err.status = 401;
    throw err;
  }

  const [summary, recentRows, monthlyRows, topProductRows] = await Promise.all([
    repo.getSummary(pool, { companyId, branchId }),
    repo.getRecentSales(pool, { companyId, branchId, limit: 5 }),
    repo.getMonthlySalesTrend(pool, { companyId, branchId, months: 6 }),
    repo.getTopProducts(pool, { companyId, branchId, limit: 5 }),
  ]);

  return {
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
  };
}
