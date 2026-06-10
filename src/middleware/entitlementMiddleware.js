import { resolveEntitlementsForStaff } from '../core/services/entitlement.service.js';

async function ensureAccess(req) {
  if (!req.authStaff) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
  if (!req.access) {
    req.access = await resolveEntitlementsForStaff(req.authStaff);
  }
  return req.access;
}

function deny(res, status, message, extra = {}) {
  return res.status(status).json({ message, ...extra });
}

function hasPermissionForFeature(access, featureCode) {
  if (access.meta?.source === 'legacy-fallback') return true;
  const permissions = Array.isArray(access.permissions) ? access.permissions : [];
  if (!featureCode) return true;

  const code = String(featureCode);
  if (!code.includes('.')) {
    return permissions.some(
      (permission) => permission === `${code}.view` || (
        permission.startsWith(`${code}.`) && permission.endsWith('.view')
      )
    );
  }

  return permissions.includes(`${code}.view`);
}

export function requireActiveSubscription() {
  return async (req, res, next) => {
    try {
      const access = await ensureAccess(req);
      if (access.subscription?.isUsable !== false) return next();
      return deny(res, 402, 'Subscription is not active', {
        subscription: access.subscription,
      });
    } catch (err) {
      return deny(res, err.status || 500, err.message || 'Access check failed');
    }
  };
}

export function requireFeature(featureCode) {
  return async (req, res, next) => {
    try {
      const access = await ensureAccess(req);
      if (access.subscription?.isUsable === false) {
        return deny(res, 402, 'Subscription is not active', {
          subscription: access.subscription,
        });
      }
      if (access.meta?.source === 'legacy-fallback') return next();
      if (access.features?.[featureCode] !== true) {
        return deny(res, 403, 'Feature is not enabled', { featureCode });
      }
      if (hasPermissionForFeature(access, featureCode)) return next();
      return deny(res, 403, 'Permission is not granted', { featureCode });
    } catch (err) {
      return deny(res, err.status || 500, err.message || 'Access check failed');
    }
  };
}

export function requireAnyFeature(featureCodes) {
  const codes = Array.isArray(featureCodes) ? featureCodes : [featureCodes];
  return async (req, res, next) => {
    try {
      const access = await ensureAccess(req);
      if (access.subscription?.isUsable === false) {
        return deny(res, 402, 'Subscription is not active', {
          subscription: access.subscription,
        });
      }
      if (access.meta?.source === 'legacy-fallback') return next();
      const enabledCodes = codes.filter((code) => access.features?.[code] === true);
      if (!enabledCodes.length) {
        return deny(res, 403, 'Feature is not enabled', { featureCodes: codes });
      }
      if (enabledCodes.some((code) => hasPermissionForFeature(access, code))) return next();
      return deny(res, 403, 'Permission is not granted', { featureCodes: codes });
    } catch (err) {
      return deny(res, err.status || 500, err.message || 'Access check failed');
    }
  };
}

export function requirePermission(permissionCode) {
  return async (req, res, next) => {
    try {
      const access = await ensureAccess(req);
      if (access.subscription?.isUsable === false) {
        return deny(res, 402, 'Subscription is not active', {
          subscription: access.subscription,
        });
      }
      if (access.meta?.source === 'legacy-fallback') return next();
      if (access.permissions?.includes(permissionCode)) return next();
      return deny(res, 403, 'Permission is not granted', { permissionCode });
    } catch (err) {
      return deny(res, err.status || 500, err.message || 'Access check failed');
    }
  };
}
