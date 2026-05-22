import * as tenantRepo from '../repositories/tenantAdmin.repository.js';

export async function listTenants(filters) {
  return tenantRepo.listTenants(filters);
}

export async function getTenantDetail(companyId) {
  const tenant = await tenantRepo.getTenant(companyId);
  if (!tenant) {
    const err = new Error('Tenant not found');
    err.status = 404;
    throw err;
  }
  const [featureOverrides, limitOverrides] = await Promise.all([
    tenantRepo.listFeatureOverrides(companyId),
    tenantRepo.listLimitOverrides(companyId),
  ]);
  return { tenant, featureOverrides, limitOverrides };
}

const ALLOWED_SUBSCRIPTION_FIELDS = new Set([
  'plan_code',
  'status',
  'trial_started_at',
  'trial_ends_at',
  'subscription_started_at',
  'current_period_starts_at',
  'current_period_ends_at',
  'grace_ends_at',
  'cancelled_at',
  'suspended_at',
  'suspension_reason',
]);

const VALID_STATUSES = new Set(['trial', 'active', 'grace', 'expired', 'suspended', 'cancelled']);

export async function updateSubscription({ companyId, patch, actorPlatformUserId }) {
  const before = await tenantRepo.getTenant(companyId);
  if (!before) {
    const err = new Error('Tenant not found');
    err.status = 404;
    throw err;
  }
  const cleanPatch = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (!ALLOWED_SUBSCRIPTION_FIELDS.has(k)) continue;
    if (k === 'status' && v && !VALID_STATUSES.has(v)) {
      const err = new Error(`Invalid status: ${v}`);
      err.status = 400;
      throw err;
    }
    cleanPatch[k] = v;
  }
  const after = await tenantRepo.upsertSubscription(companyId, cleanPatch);
  await tenantRepo.appendAuditLog({
    companyId,
    actorPlatformUserId,
    action: 'subscription.update',
    entityType: 'subscription',
    entityId: after?.subscription_id,
    beforeJson: before,
    afterJson: after,
  });
  return after;
}

export async function setFeatureOverride({ companyId, featureCode, isEnabled, reason, expiresAt, actorPlatformUserId }) {
  const beforeAll = await tenantRepo.listFeatureOverrides(companyId);
  const before = beforeAll.find((r) => r.feature_code === featureCode) || null;
  const after = await tenantRepo.upsertFeatureOverride({
    companyId,
    featureCode,
    isEnabled,
    reason,
    expiresAt,
    createdBy: actorPlatformUserId,
  });
  await tenantRepo.appendAuditLog({
    companyId,
    actorPlatformUserId,
    action: 'feature.override',
    entityType: 'feature_override',
    entityId: featureCode,
    beforeJson: before,
    afterJson: after,
  });
  return after;
}

export async function clearFeatureOverride({ companyId, featureCode, actorPlatformUserId }) {
  const before = await tenantRepo.deleteFeatureOverride(companyId, featureCode);
  if (!before) return null;
  await tenantRepo.appendAuditLog({
    companyId,
    actorPlatformUserId,
    action: 'feature.override.clear',
    entityType: 'feature_override',
    entityId: featureCode,
    beforeJson: before,
    afterJson: null,
  });
  return before;
}

export async function clearLimitOverride({ companyId, limitCode, actorPlatformUserId }) {
  const before = await tenantRepo.deleteLimitOverride(companyId, limitCode);
  if (!before) return null;
  await tenantRepo.appendAuditLog({
    companyId,
    actorPlatformUserId,
    action: 'limit.override.clear',
    entityType: 'limit_override',
    entityId: limitCode,
    beforeJson: before,
    afterJson: null,
  });
  return before;
}

export async function setLimitOverride({ companyId, limitCode, limitValue, reason, expiresAt, actorPlatformUserId }) {
  const beforeAll = await tenantRepo.listLimitOverrides(companyId);
  const before = beforeAll.find((r) => r.limit_code === limitCode) || null;
  const after = await tenantRepo.upsertLimitOverride({
    companyId,
    limitCode,
    limitValue,
    reason,
    expiresAt,
    createdBy: actorPlatformUserId,
  });
  await tenantRepo.appendAuditLog({
    companyId,
    actorPlatformUserId,
    action: 'limit.override',
    entityType: 'limit_override',
    entityId: limitCode,
    beforeJson: before,
    afterJson: after,
  });
  return after;
}

export async function suspendTenant({ companyId, reason, actorPlatformUserId }) {
  return updateSubscription({
    companyId,
    actorPlatformUserId,
    patch: {
      status: 'suspended',
      suspended_at: new Date().toISOString(),
      suspension_reason: reason || null,
    },
  });
}

export async function reactivateTenant({ companyId, actorPlatformUserId }) {
  return updateSubscription({
    companyId,
    actorPlatformUserId,
    patch: {
      status: 'active',
      suspended_at: null,
      suspension_reason: null,
    },
  });
}

export async function extendTrial({ companyId, days, actorPlatformUserId }) {
  const tenant = await tenantRepo.getTenant(companyId);
  const base = tenant?.trial_ends_at ? new Date(tenant.trial_ends_at) : new Date();
  const newEnd = new Date(base.getTime() + Number(days) * 86400 * 1000);
  return updateSubscription({
    companyId,
    actorPlatformUserId,
    patch: {
      status: 'trial',
      trial_ends_at: newEnd.toISOString(),
    },
  });
}

export async function listAuditLog(companyId, opts) {
  return tenantRepo.listAuditLog(companyId, opts);
}
