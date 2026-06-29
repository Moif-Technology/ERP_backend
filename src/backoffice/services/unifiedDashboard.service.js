import { pool } from '../../config/db.js';
import * as backofficeDashboard from './backofficeDashboard.service.js';
import * as crmDashboard from '../../crm/services/crmDashboard.service.js';
import * as garageDashboard from '../../garage/services/garageDashboard.service.js';
import * as hrService from '../../hr/services/hr.service.js';
import * as accountsDashboard from '../../accounts/services/accountsDashboard.service.js';

async function safe(name, loader) {
  try {
    return { ok: true, data: await loader() };
  } catch (err) {
    console.error(`[dashboard:${name}]`, err);
    return { ok: false, error: err.message || `Could not load ${name}` };
  }
}

export async function getUnifiedDashboard(authStaff, query = {}) {
  const enabled = {
    backoffice: true,
    pos: true,
    crm: true,
    garage: true,
    hr: true,
    accounts: true,
  };

  const modules = {};

  modules.backoffice = await safe('backoffice', () => backofficeDashboard.getBackofficeDashboard(pool, authStaff, query));
  modules.crm = await safe('crm', () => crmDashboard.getDashboard(pool, authStaff));
  modules.garage = await safe('garage', () => garageDashboard.getDashboardKpis(pool, query, authStaff));
  modules.hr = await safe('hr', () => hrService.dashboardSummary(pool, authStaff, query));
  modules.accounts = await safe('accounts', () => accountsDashboard.getAccountsDashboard(pool, authStaff, query));

  return {
    generatedAt: new Date().toISOString(),
    enabled,
    subscription: { status: 'active', planCode: 'custom', isUsable: true, mode: 'normal' },
    limits: {},
    modules,
  };
}
