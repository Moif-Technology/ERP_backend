import * as dashboardRepo from '../repositories/accountsDashboard.repository.js';
import * as voucherRepo from '../repositories/voucher.repository.js';
import * as voucherService from './voucher.service.js';
import * as financialReportService from './financialReport.service.js';

const number = (value) => Number(value || 0);
const round = (value) => Number(number(value).toFixed(2));

function parseDate(value, fallback) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return fallback;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? fallback : text;
}

function total(rows, field) {
  return rows.reduce((sum, row) => sum + number(row[field]), 0);
}

function mapAgingRow(row) {
  return {
    accountId: Number(row.accountId),
    accountNo: row.accountNo,
    accountHead: row.accountHead,
    billCount: number(row.billCount),
    outstanding: round(row.outstanding),
    lastBillDate: row.lastBillDate,
    age0_30: round(row.age0_30),
    age30_60: round(row.age30_60),
    age60_120: round(row.age60_120),
    age120Plus: round(row.age120Plus),
  };
}

export function resolveAccountsDashboardPeriod(query = {}, now = new Date()) {
  const defaultTo = now.toISOString().slice(0, 10);
  const defaultFromDate = new Date(now);
  defaultFromDate.setUTCDate(defaultFromDate.getUTCDate() - 29);
  const dateFrom = parseDate(query.dateFrom || query.from, defaultFromDate.toISOString().slice(0, 10));
  const dateTo = parseDate(query.dateTo || query.to, defaultTo);
  if (dateFrom > dateTo) {
    const err = new Error('dateFrom cannot be after dateTo');
    err.status = 400;
    throw err;
  }
  const days = Math.floor(
    (new Date(`${dateTo}T00:00:00Z`) - new Date(`${dateFrom}T00:00:00Z`)) / 86400000,
  ) + 1;
  if (days > 366) {
    const err = new Error('Accounts dashboard date range cannot exceed 366 days');
    err.status = 400;
    throw err;
  }
  return { dateFrom, dateTo, days };
}

export async function getAccountsDashboard(pool, authStaff, query = {}) {
  const companyId = Number(authStaff.company_id);
  const branchId = Number(authStaff.branch_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid session company');
    err.status = 401;
    throw err;
  }

  const { dateFrom, dateTo, days } = resolveAccountsDashboardPeriod(query);

  const scopedQuery = {
    branchId,
    dateFrom,
    dateTo,
    postStatus: 'POSTED',
  };

  const [
    receivablesResult,
    payablesResult,
    profitLoss,
    cashBank,
    recentResult,
    voucherTypes,
    trend,
  ] = await Promise.all([
    voucherService.getAgingSummary(pool, authStaff, {
      branchId,
      summaryType: 'receivable',
      postStatus: 'POSTED',
      dateTo,
    }),
    voucherService.getAgingSummary(pool, authStaff, {
      branchId,
      summaryType: 'payable',
      postStatus: 'POSTED',
      dateTo,
    }),
    financialReportService.getProfitAndLoss(pool, authStaff, scopedQuery),
    dashboardRepo.getCashBankBalance(pool, { companyId, branchId, dateTo }),
    voucherRepo.listVouchers(pool, companyId, {
      ...scopedQuery,
      page: 1,
      pageSize: 8,
    }),
    dashboardRepo.getVoucherTypeBreakdown(pool, { companyId, branchId, dateFrom, dateTo }),
    dashboardRepo.getFinancialTrend(pool, { companyId, branchId, dateFrom, dateTo }),
  ]);

  const receivables = receivablesResult.rows.map(mapAgingRow);
  const payables = payablesResult.rows.map(mapAgingRow);
  const totalReceivables = total(receivables, 'outstanding');
  const totalPayables = total(payables, 'outstanding');
  const revenue = number(profitLoss.trading?.totalIncome) + number(profitLoss.profitLoss?.totalIncome);
  const expenses = number(profitLoss.trading?.totalExpenses) + number(profitLoss.profitLoss?.totalExpenses);

  return {
    period: { dateFrom, dateTo, days },
    summary: {
      receivables: round(totalReceivables),
      payables: round(totalPayables),
      netPosition: round(totalReceivables - totalPayables),
      cashBank: round(cashBank.balance),
      revenue: round(revenue),
      expenses: round(expenses),
      netProfit: round(profitLoss.netProfit),
      voucherCount: number(recentResult.total),
    },
    aging: {
      receivables: {
        age0_30: round(total(receivables, 'age0_30')),
        age30_60: round(total(receivables, 'age30_60')),
        age60_120: round(total(receivables, 'age60_120')),
        age120Plus: round(total(receivables, 'age120Plus')),
      },
    },
    receivables: receivables.slice(0, 8),
    payables: payables.slice(0, 8),
    recentVouchers: recentResult.rows.map((row) => ({
      voucherMasterId: Number(row.voucher_master_id),
      voucherNo: `${row.voucher_prefix || ''}${row.auto_voucher_no || ''}` || `V-${row.voucher_master_id}`,
      voucherType: row.voucher_name || row.voucher_type_code || 'Voucher',
      voucherTypeCode: row.voucher_type_code || 'OTHER',
      party: row.customer_name || row.remarks || row.reference_no || 'General account',
      amount: round(row.voucher_amount),
      voucherDate: row.voucher_date,
      postStatus: row.post_status || 'PENDING',
    })),
    voucherTypes: voucherTypes.map((row) => ({
      code: row.code,
      name: row.name,
      count: number(row.count),
      amount: round(row.amount),
    })),
    trend: trend.map((row) => ({
      label: row.label,
      revenue: round(row.revenue),
      expenses: round(row.expenses),
    })),
  };
}
