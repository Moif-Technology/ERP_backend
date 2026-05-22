import * as tenantService from '../services/tenant.service.js';

function actorId(req) {
  return req.platformUser?.platformUserId || null;
}

function handle(err, res) {
  return res.status(err.status || 500).json({ message: err.message });
}

export async function list(req, res) {
  try {
    const { status, search, limit, offset } = req.query;
    const rows = await tenantService.listTenants({
      status,
      search,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return res.json({ tenants: rows });
  } catch (err) {
    return handle(err, res);
  }
}

export async function detail(req, res) {
  try {
    const data = await tenantService.getTenantDetail(Number(req.params.companyId));
    return res.json(data);
  } catch (err) {
    return handle(err, res);
  }
}

export async function patchSubscription(req, res) {
  try {
    const after = await tenantService.updateSubscription({
      companyId: Number(req.params.companyId),
      patch: req.body || {},
      actorPlatformUserId: actorId(req),
    });
    return res.json({ subscription: after });
  } catch (err) {
    return handle(err, res);
  }
}

export async function setFeature(req, res) {
  try {
    const after = await tenantService.setFeatureOverride({
      companyId: Number(req.params.companyId),
      featureCode: req.body?.featureCode,
      isEnabled: !!req.body?.isEnabled,
      reason: req.body?.reason,
      expiresAt: req.body?.expiresAt,
      actorPlatformUserId: actorId(req),
    });
    return res.json({ override: after });
  } catch (err) {
    return handle(err, res);
  }
}

export async function clearFeature(req, res) {
  try {
    await tenantService.clearFeatureOverride({
      companyId: Number(req.params.companyId),
      featureCode: req.params.featureCode,
      actorPlatformUserId: actorId(req),
    });
    return res.json({ ok: true });
  } catch (err) {
    return handle(err, res);
  }
}

export async function clearLimit(req, res) {
  try {
    await tenantService.clearLimitOverride({
      companyId: Number(req.params.companyId),
      limitCode: req.params.limitCode,
      actorPlatformUserId: actorId(req),
    });
    return res.json({ ok: true });
  } catch (err) {
    return handle(err, res);
  }
}

export async function setLimit(req, res) {
  try {
    const after = await tenantService.setLimitOverride({
      companyId: Number(req.params.companyId),
      limitCode: req.body?.limitCode,
      limitValue: Number(req.body?.limitValue),
      reason: req.body?.reason,
      expiresAt: req.body?.expiresAt,
      actorPlatformUserId: actorId(req),
    });
    return res.json({ override: after });
  } catch (err) {
    return handle(err, res);
  }
}

export async function suspend(req, res) {
  try {
    const after = await tenantService.suspendTenant({
      companyId: Number(req.params.companyId),
      reason: req.body?.reason,
      actorPlatformUserId: actorId(req),
    });
    return res.json({ subscription: after });
  } catch (err) {
    return handle(err, res);
  }
}

export async function reactivate(req, res) {
  try {
    const after = await tenantService.reactivateTenant({
      companyId: Number(req.params.companyId),
      actorPlatformUserId: actorId(req),
    });
    return res.json({ subscription: after });
  } catch (err) {
    return handle(err, res);
  }
}

export async function extendTrial(req, res) {
  try {
    const after = await tenantService.extendTrial({
      companyId: Number(req.params.companyId),
      days: Number(req.body?.days || 0),
      actorPlatformUserId: actorId(req),
    });
    return res.json({ subscription: after });
  } catch (err) {
    return handle(err, res);
  }
}

export async function audit(req, res) {
  try {
    const rows = await tenantService.listAuditLog(Number(req.params.companyId), {
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    return res.json({ entries: rows });
  } catch (err) {
    return handle(err, res);
  }
}
