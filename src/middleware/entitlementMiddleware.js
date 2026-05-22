import { resolveEntitlementsForStaff } from '../services/entitlement.service.js';

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
      if (access.features?.[featureCode] === true) return next();
      return deny(res, 403, 'Feature is not enabled', { featureCode });
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
      if (codes.some((code) => access.features?.[code] === true)) return next();
      return deny(res, 403, 'Feature is not enabled', { featureCodes: codes });
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
