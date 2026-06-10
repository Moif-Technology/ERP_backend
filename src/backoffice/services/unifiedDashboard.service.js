import { pool } from '../../config/db.js';
import { resolveEntitlementsForStaff } from '../../core/services/entitlement.service.js';
import * as backofficeDashboard from './backofficeDashboard.service.js';
import * as crmDashboard from '../../crm/services/crmDashboard.service.js';
import * as garageDashboard from '../../garage/services/garageDashboard.service.js';
import * as hrService from '../../hr/services/hr.service.js';

async function safe(name, loader) {
  try {
    return { ok: true, data: await loader() };
  } catch (err) {
    console.error(`[dashboard:${name}]`, err);
    return { ok: false, error: err.message || `Could not load ${name}` };
  }
}

export async function getUnifiedDashboard(authStaff, query = {}) {
  const access = await resolveEntitlementsForStaff(authStaff);
  const features = access.features || {};

  const enabled = {
    backoffice: features['backoffice.dashboard'] === true || features.backoffice === true,
    pos: features.pos === true,
    crm: features['crm.dashboard'] === true || features.crm === true,
    garage: features.garage === true,
    hr: features['hr.dashboard'] === true || features.hr === true,
  };

  const modules = {};

  if (enabled.backoffice || enabled.pos) {
    modules.backoffice = await safe('backoffice', () => backofficeDashboard.getBackofficeDashboard(pool, authStaff));
  }
  if (enabled.crm) {
    modules.crm = await safe('crm', () => crmDashboard.getDashboard(pool, authStaff));
  }
  if (enabled.garage) {
    modules.garage = await safe('garage', () => garageDashboard.getDashboardKpis(pool, query, authStaff));
  }
  if (enabled.hr) {
    modules.hr = await safe('hr', () => hrService.dashboardSummary(pool, authStaff, query));
  }

  return {
    generatedAt: new Date().toISOString(),
    enabled,
    subscription: access.subscription || null,
    limits: access.limits || {},
    modules,
  };
}
