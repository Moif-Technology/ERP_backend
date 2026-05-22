import { pool } from '../config/db.js';
import * as entitlementRepo from '../repositories/entitlement.repository.js';

const MISSING_ENTITLEMENT_TABLE = new Set(['42P01', '42703']);

const DEFAULT_SUBSCRIPTION = {
  status: 'active',
  planCode: 'legacy',
  isUsable: true,
  mode: 'normal',
  trialEndsAt: null,
  currentPeriodEndsAt: null,
  graceEndsAt: null,
  suspensionReason: null,
};

const POS_CONTROL_FEATURES = {
  btnSaveKOT: 'pos.kot',
  btnPrintKOT: 'pos.kot',
  btnKOTReprint: 'pos.kot',
  btnBillCancel: 'pos.void_bill',
  btnDiscount: 'pos.discount',
  btnDummyBill: 'pos.billing',
  btnComments: 'pos.billing',
  btnAreaMaster: 'pos.areas',
  btnSettlement: 'pos.settlement',
  btnSalesViewer: 'pos.counter_reports',
  btnReturnBill: 'pos.return_bill',
  btnControlPanel: 'pos.settings',
  btnCounterClose: 'pos.counter_open_close',
  btnWaiterAssignment: 'pos.tables',
};

const POS_CONTROL_LABELS = {
  btnSaveKOT: 'Save KOT',
  btnPrintKOT: 'Print KOT',
  btnKOTReprint: 'Reprint KOT',
  btnBillCancel: 'Cancel bill',
  btnDiscount: 'Discount',
  btnDummyBill: 'Dummy bill',
  btnComments: 'Comments',
  btnAreaMaster: 'Area master',
  btnSettlement: 'Settlement',
  btnSalesViewer: 'Sales viewer',
  btnReturnBill: 'Return bill',
  btnControlPanel: 'Control panel',
  btnCounterClose: 'Counter close',
  btnWaiterAssignment: 'Waiter assignment',
};

function isMissingEntitlementSchema(err) {
  return MISSING_ENTITLEMENT_TABLE.has(err?.code);
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : value ?? null;
}

function normalizeStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  if (['trial', 'active', 'grace', 'expired', 'suspended', 'cancelled'].includes(s)) {
    return s;
  }
  return 'trial';
}

export function resolveSubscriptionState(row) {
  if (!row) return DEFAULT_SUBSCRIPTION;

  const now = Date.now();
  let status = normalizeStatus(row.status);
  const trialEndsAt = row.trial_ends_at ? new Date(row.trial_ends_at) : null;
  const periodEndsAt = row.current_period_ends_at ? new Date(row.current_period_ends_at) : null;
  const graceEndsAt = row.grace_ends_at ? new Date(row.grace_ends_at) : null;

  if (status === 'trial' && trialEndsAt && trialEndsAt.getTime() < now) {
    status = 'expired';
  }
  if (status === 'active' && periodEndsAt && periodEndsAt.getTime() < now) {
    status = graceEndsAt && graceEndsAt.getTime() >= now ? 'grace' : 'expired';
  }
  if (status === 'grace' && graceEndsAt && graceEndsAt.getTime() < now) {
    status = 'expired';
  }

  const isUsable = status === 'trial' || status === 'active' || status === 'grace';
  const mode = isUsable ? 'normal' : status;

  return {
    status,
    planCode: row.plan_code || 'legacy',
    isUsable,
    mode,
    trialEndsAt: toIso(row.trial_ends_at),
    currentPeriodEndsAt: toIso(row.current_period_ends_at),
    graceEndsAt: toIso(row.grace_ends_at),
    suspensionReason: row.suspension_reason || null,
  };
}

function objectFromRows(rows, keyName, valueName, defaultValue = true) {
  return Object.fromEntries(
    rows.map((row) => [row[keyName], valueName ? row[valueName] : defaultValue])
  );
}

export function defaultPermissionsFromFeatures(features) {
  const permissions = [];
  for (const [featureCode, enabled] of Object.entries(features)) {
    if (!enabled) continue;
    permissions.push(`${featureCode}.view`);
    permissions.push(`${featureCode}.create`);
    permissions.push(`${featureCode}.edit`);
    permissions.push(`${featureCode}.delete`);
  }
  return permissions;
}

export function applyOverrides(base, overrides, keyName, valueName) {
  const out = { ...base };
  for (const row of overrides) {
    out[row[keyName]] = row[valueName];
  }
  return out;
}

function buildLegacyFallback(companyId, roleId) {
  return {
    subscription: DEFAULT_SUBSCRIPTION,
    features: {},
    limits: {},
    permissions: [],
    meta: {
      companyId,
      roleId,
      source: 'legacy-fallback',
    },
  };
}

export async function resolveEntitlementsForStaff(staffRow, db = pool) {
  const companyId = Number(staffRow?.company_id);
  const roleId = staffRow?.role_id == null ? null : Number(staffRow.role_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    return buildLegacyFallback(null, roleId);
  }

  try {
    const subscriptionRow =
      (await entitlementRepo.findTenantSubscription(db, companyId)) ??
      (await entitlementRepo.findOnboardingSubscriptionFallback(db, companyId));
    const subscription = resolveSubscriptionState(subscriptionRow);
    const planCode = subscription.planCode;

    const [planFeatures, featureOverrides, planLimits, limitOverrides, rolePermissions] =
      await Promise.all([
        entitlementRepo.listPlanFeatures(db, planCode),
        entitlementRepo.listTenantFeatureOverrides(db, companyId),
        entitlementRepo.listPlanLimits(db, planCode),
        entitlementRepo.listTenantLimitOverrides(db, companyId),
        entitlementRepo.listRolePermissions(db, companyId, roleId),
      ]);

    const features = applyOverrides(
      objectFromRows(planFeatures, 'feature_code', 'is_enabled'),
      featureOverrides,
      'feature_code',
      'is_enabled'
    );

    // Core master data always available for any usable subscription
    if (subscription.isUsable) {
      features['core.customers'] = true;
      features['core.suppliers'] = true;
      features['core.products'] = true;
    }

    const limits = applyOverrides(
      objectFromRows(planLimits, 'limit_code', 'limit_value'),
      limitOverrides,
      'limit_code',
      'limit_value'
    );
    const explicitPermissions = rolePermissions
      .filter((row) => row.is_allowed)
      .map((row) => row.permission_code);
    const permissions =
      roleId == null
        ? []
        : explicitPermissions.length
          ? explicitPermissions
          : defaultPermissionsFromFeatures(features);

    return {
      subscription,
      features,
      limits,
      permissions,
      meta: {
        companyId,
        roleId,
        source: 'entitlement-tables',
        version: subscriptionRow?.updated_at
          ? new Date(subscriptionRow.updated_at).getTime()
          : null,
      },
    };
  } catch (err) {
    if (isMissingEntitlementSchema(err)) {
      return buildLegacyFallback(companyId, roleId);
    }
    throw err;
  }
}

/**
 * Throws err.status=409 (LIMIT_EXCEEDED) when current count >= configured limit.
 * countFn(db, companyId) -> Promise<number>
 */
export async function assertLimitAvailable({ companyId, limitCode, countFn, db = pool }) {
  const access = await resolveEntitlementsForStaff({ company_id: companyId }, db);
  const limitValue = access.limits?.[limitCode];
  if (limitValue == null) return; // unlimited / unconfigured
  const current = await countFn(db, companyId);
  if (current >= Number(limitValue)) {
    const err = new Error(`Limit exceeded for ${limitCode} (cap=${limitValue}, current=${current})`);
    err.status = 409;
    err.code = 'LIMIT_EXCEEDED';
    err.limitCode = limitCode;
    err.limitValue = Number(limitValue);
    err.current = current;
    throw err;
  }
}

export async function resolvePosPrivilegesForStaff(staffRow, db = pool) {
  const access = await resolveEntitlementsForStaff(staffRow, db);
  const subscriptionAllows = access.subscription?.isUsable !== false;

  return Object.entries(POS_CONTROL_FEATURES).map(([ControlName, featureCode]) => {
    const featureEnabled =
      Object.prototype.hasOwnProperty.call(access.features, featureCode)
        ? access.features[featureCode] === true
        : access.meta?.source === 'legacy-fallback';
    const IsEnable = Boolean(subscriptionAllows && featureEnabled);
    return {
      ControlName,
      IsEnable,
      key: ControlName,
      label: POS_CONTROL_LABELS[ControlName] || ControlName,
      enabled: IsEnable,
      featureCode,
    };
  });
}

export async function getEntitlementVersionForStaff(staffRow, db = pool) {
  const companyId = Number(staffRow?.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) return 0;

  try {
    return await entitlementRepo.getEntitlementVersion(db, companyId);
  } catch (err) {
    if (isMissingEntitlementSchema(err)) return 0;
    if (err?.code === '42703') {
      const access = await resolveEntitlementsForStaff(staffRow, db);
      return Number(access?.meta?.version || 0);
    }
    throw err;
  }
}
