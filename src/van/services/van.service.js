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
  const branchId  = Number(authStaff.branch_id);

  // Pull cash/card receipt ledger accounts from accounts_parameter config
  const { rows: params } = await pool.query(
    `SELECT parameter_name, account_id
     FROM accounts.accounts_parameter
     WHERE company_id = $1
       AND parameter_name IN ('DEFAULT_CASH_LEDGER', 'DEFAULT_CARD_LEDGER',
                              'CODRCashReceiptLedger', 'CODRCreditCardReceiptLedger')
       AND account_id IS NOT NULL`,
    [companyId],
  );

  if (!params.length) {
    // Fallback: all posting accounts under bank/cash groups (account_no 03-01% or 03-02%)
    const all = await accountHeadRepo.listAccountHeads(pool, companyId, { postingOnly: true });
    return all
      .filter(r => String(r.account_no ?? '').match(/^03-0[12]/))
      .map(r => ({
        accountId:   Number(r.account_id),
        accountNo:   r.account_no,
        accountHead: r.account_head,
        accountType: r.account_type ?? '',
      }));
  }

  // Deduplicate and look up account details
  const seen = new Set();
  const accountIds = [];
  for (const p of params) {
    const id = Number(p.account_id);
    if (!seen.has(id)) { seen.add(id); accountIds.push(id); }
  }

  const all = await accountHeadRepo.listAccountHeads(pool, companyId, { postingOnly: true });
  return all
    .filter(r => accountIds.includes(Number(r.account_id)))
    .map(r => ({
      accountId:   Number(r.account_id),
      accountNo:   r.account_no,
      accountHead: r.account_head,
      accountType: r.account_type ?? '',
    }));
}

export async function createSale(authStaff, body) {
  return saleEntryService.createSale(pool, body, authStaff, { salesChannel: 'VAN' });
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

export async function getVans(authStaff) {
  const companyId = Number(authStaff.company_id);
  const rows = await vanRepo.listVans(pool, companyId);
  return rows
    .filter(r => r.is_active)
    .map(r => ({
      vanId:   Number(r.van_id),
      vanCode: r.van_code,
      vanName: r.van_name,
      plateNo: r.plate_no ?? '',
    }));
}

export async function getRoutes(authStaff) {
  const companyId = Number(authStaff.company_id);
  const rows = await vanRepo.listRoutes(pool, companyId);
  return rows
    .filter(r => r.is_active)
    .map(r => ({
      routeId:   Number(r.route_id),
      routeCode: r.route_code,
      routeName: r.route_name,
      description: r.description ?? '',
    }));
}

export async function getTodayAssignment(authStaff) {
  const companyId = Number(authStaff.company_id);
  const staffId   = Number(authStaff.staff_id);
  const today     = new Date().toISOString().slice(0, 10);
  return vanRepo.getTodayAssignment(pool, companyId, staffId, today);
}

export async function startDay(authStaff, body) {
  const companyId = Number(authStaff.company_id);
  const branchId  = authStaff.branch_id != null ? Number(authStaff.branch_id) : null;
  const staffId   = Number(authStaff.staff_id);
  const actor     = String(authStaff.staff_id ?? 'van');

  const vanId = Number(body.vanId);
  if (!vanId) {
    const err = new Error('vanId is required'); err.status = 400; throw err;
  }

  const routeId      = body.routeId ? Number(body.routeId) : null;
  const openingCash  = Number(body.openingCash ?? 0);
  const today        = new Date().toISOString().slice(0, 10);

  const row = await vanRepo.insertDayAssignment(pool, {
    companyId, branchId, staffId, vanId, routeId,
    assignmentDate: today, openingCash, actor,
  });
  return row;
}

export async function getDashboard(authStaff, date) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);
  const staffId   = Number(authStaff.staff_id);
  const today     = new Date().toISOString().slice(0, 10);
  const target    = /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? '')) ? date : today;
  const stats     = await vanRepo.getDashboardStats(pool, companyId, branchId, staffId, target);
  return {
    todayRevenue:   Number(stats.revenue),
    todayInvoices:  stats.invoice_count,
    totalCustomers: stats.total_customers,
    totalSkus:      stats.total_skus,
  };
}
