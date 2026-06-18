import { pool } from '../../config/db.js';
import { cacheGet, cacheSet } from '../../config/redis.js';
import * as entitlementRepo from '../repositories/entitlement.repository.js';

// The access-version endpoint is polled by every client every 30s. The version
// is per-company (same for all staff in a company), so cache it briefly: the
// 7-table aggregate query then runs ~once per company per TTL instead of once
// per client per poll. TTL kept short so entitlement changes propagate fast.
const VERSION_CACHE_TTL_SECONDS = 10;
const versionCacheKey = (companyId) => `entver:${companyId}`;

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

/**
 * Software-type ("module") scope for a company. Returns null when the company
 * has no software type or the mapping is absent — callers then keep the
 * legacy plan-only behaviour. Errors from a missing software_type_feature
 * table are swallowed here so one unapplied migration cannot collapse the
 * whole entitlement resolve into the legacy fallback.
 */
async function resolveSoftwareTypeScope(db, companyId) {
  try {
    const softwareTypeId = await entitlementRepo.findCompanySoftwareTypeId(db, companyId);
    if (softwareTypeId == null) return null;
    const rows = await entitlementRepo.listSoftwareTypeFeatures(db, softwareTypeId);
    if (rows.length === 0) return null;
    const allowed = new Set();
    const granted = [];
    for (const row of rows) {
      allowed.add(row.feature_code);
      if (row.is_granted) granted.push(row.feature_code);
    }
    return { softwareTypeId: Number(softwareTypeId), allowed, granted };
  } catch (err) {
    if (isMissingEntitlementSchema(err)) return null;
    throw err;
  }
}

function applySoftwareTypeScope(features, scope) {
  if (!scope) return features;
  const scoped = {};
  for (const [code, enabled] of Object.entries(features)) {
    if (scope.allowed.has(code)) scoped[code] = enabled;
  }
  for (const code of scope.granted) scoped[code] = true;
  return scoped;
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

    const [planFeatures, featureOverrides, planLimits, limitOverrides, rolePermissions, softwareTypeScope] =
      await Promise.all([
        entitlementRepo.listPlanFeatures(db, planCode),
        entitlementRepo.listTenantFeatureOverrides(db, companyId),
        entitlementRepo.listPlanLimits(db, planCode),
        entitlementRepo.listTenantLimitOverrides(db, companyId),
        entitlementRepo.listRolePermissions(db, companyId, roleId),
        resolveSoftwareTypeScope(db, companyId),
      ]);

    // Plan decides the tier; the company's software type (module bundle)
    // decides which features that tier can ever reach. Granted features are
    // included with the module regardless of plan. Tenant overrides win last.
    const features = applyOverrides(
      applySoftwareTypeScope(
        objectFromRows(planFeatures, 'feature_code', 'is_enabled'),
        softwareTypeScope
      ),
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
    // Permissions only count when their feature is enabled for this company
    // (plan ∩ software type). Stale role_permission rows for features the
    // company doesn't have (e.g. admin seeded with everything) are dropped.
    const explicitPermissions = rolePermissions
      .filter((row) => row.is_allowed)
      .filter((row) => !row.feature_code || features[row.feature_code] === true)
      .map((row) => row.permission_code);
    const permissions = roleId == null ? [] : explicitPermissions;

    return {
      subscription,
      features,
      limits,
      permissions,
      meta: {
        companyId,
        roleId,
        softwareTypeId: softwareTypeScope?.softwareTypeId ?? null,
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

  // Fast path: cached per-company version (no-op miss when Redis is off).
  const cached = await cacheGet(versionCacheKey(companyId));
  if (cached != null) {
    const n = Number(cached);
    if (Number.isFinite(n)) return n;
  }

  try {
    const version = await entitlementRepo.getEntitlementVersion(db, companyId);
    await cacheSet(versionCacheKey(companyId), String(version), VERSION_CACHE_TTL_SECONDS);
    return version;
  } catch (err) {
    if (isMissingEntitlementSchema(err)) return 0;
    if (err?.code === '42703') {
      const access = await resolveEntitlementsForStaff(staffRow, db);
      return Number(access?.meta?.version || 0);
    }
    throw err;
  }
}
