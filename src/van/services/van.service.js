import * as coreAuthService from '../../core/services/auth.service.js';
import * as dashboardService from '../../backoffice/services/backofficeDashboard.service.js';
import * as customerService from '../../backoffice/services/customer.service.js';
import * as productService from '../../backoffice/services/product.service.js';
import * as groupService from '../../backoffice/services/group.service.js';
import * as saleEntryService from '../../backoffice/services/saleEntry.service.js';
import * as accountHeadRepo from '../../accounts/repositories/accountHead.repository.js';
import * as vanRepo from '../repositories/van.repository.js';
import { pool } from '../../config/db.js';

export async function login({ username, password }) {
  if (!username || !password) {
    const err = new Error('username and password are required');
    err.status = 400;
    throw err;
  }

  const { accessToken, refreshToken, session } =
    await coreAuthService.loginWithCredentialsForPOS(
      String(username).trim(),
      password,
      'VAN'
    );

  const u = session.user;
  const c = session.company;

  return {
    staffId:     u.staffId     != null ? String(u.staffId)    : '',
    staffName:   u.staffName   ?? '',
    companyId:   c?.companyId  != null ? String(c.companyId)  : '',
    companyName: c?.companyName ?? '',
    designation: u.designation ?? '',
    accessToken,
    refreshToken,
    permissions: session.permissions ?? [],
    features:    session.features    ?? {},
  };
}

export async function getProducts(authStaff) {
  const [products, groups] = await Promise.all([
    productService.listProducts(pool, authStaff, {}),
    groupService.listGroups(pool, authStaff),
  ]);
  const groupMap = new Map(groups.map(g => [g.groupId, g.groupDescription ?? g.groupCode ?? null]));
  return products.map(p => ({
    ...p,
    groupName: p.groupId != null ? (groupMap.get(p.groupId) ?? null) : null,
  }));
}

export async function getCustomers(authStaff, { search, limit } = {}) {
  return customerService.listCustomers(pool, authStaff, limit ?? 500, search ?? '');
}

export async function getPaymentAccounts(authStaff) {
  const companyId = Number(authStaff.company_id);
  const rows = await accountHeadRepo.listAccountHeads(pool, companyId, { postingOnly: true });
  return rows
    .filter(r => {
      const type = (r.account_type ?? '').toUpperCase();
      const no = String(r.account_no ?? '');
      // Keep Cash/Bank type accounts, or any asset-range account (no starts with '1')
      return type === 'CASH' || type === 'BANK' || no.startsWith('1');
    })
    .map(r => ({
      accountId:   Number(r.account_id),
      accountNo:   r.account_no,
      accountHead: r.account_head,
      accountType: r.account_type ?? '',
    }));
}

export async function createSale(authStaff, body) {
  return saleEntryService.createSale(pool, body, authStaff);
}

export async function getDaySummary(authStaff, dateStr) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);
  const staffId   = Number(authStaff.staff_id);
  const date      = dateStr || new Date().toISOString().slice(0, 10);

  const rows = await vanRepo.getVanDaySummary(pool, companyId, branchId, staffId, date);

  let totalRevenue = 0;
  let cashAmount   = 0;
  let creditAmount = 0;

  const sales = rows.map(r => {
    const amt = Number(r.amount) || 0;
    totalRevenue += amt;
    const mode = (r.payment_mode ?? '').toUpperCase();
    if (mode === 'CREDIT') creditAmount += amt;
    else cashAmount += amt;

    return {
      salesId:      Number(r.sales_id),
      billNo:       String(r.bill_no ?? ''),
      billDate:     r.bill_date,
      paymentMode:  r.payment_mode ?? 'CASH',
      amount:       amt,
      customerName: r.customer_name ?? null,
      customerCode: r.customer_code ?? null,
    };
  });

  return {
    date,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    billCount:    rows.length,
    cashAmount:   Math.round(cashAmount   * 100) / 100,
    creditAmount: Math.round(creditAmount * 100) / 100,
    sales,
  };
}

export async function getDashboard(authStaff) {
  const data = await dashboardService.getBackofficeDashboard(pool, authStaff);
  return {
    todayRevenue:   data.today.netSales,
    todayInvoices:  data.today.billCount,
    totalCustomers: data.setup.customers,
    totalSkus:      data.setup.products,
  };
}
