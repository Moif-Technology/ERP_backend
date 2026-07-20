export function requireActiveSubscription() {
  return (req, res, next) => {
    const subscription = req.access?.subscription;
    if (subscription && subscription.isUsable === false) {
      return res.status(402).json({
        message: 'Subscription is not active',
        status: subscription.status,
        mode: subscription.mode,
      });
    }
    next();
  };
}

export function requireFeature(featureCode) {
  return (req, res, next) => {
    const features = req.authStaff?.enabledFeatures;
    if (!features || !features.has(featureCode)) {
      return res.status(403).json({ message: 'Feature not available on your plan' });
    }
    next();
  };
}

export function requireAnyFeature(featureCodes) {
  return (req, res, next) => {
    const features = req.authStaff?.enabledFeatures;
    if (!features) {
      return res.status(403).json({ message: 'Feature not available on your plan' });
    }
    const codes = Array.isArray(featureCodes) ? featureCodes : [featureCodes];
    if (!codes.some((code) => features.has(code))) {
      return res.status(403).json({ message: 'Feature not available on your plan' });
    }
    next();
  };
}

export function requirePermission(permissionCode) {
  return (req, res, next) => {
    const perms = req.authStaff?.permissionSet;
    if (!perms || !perms.has(permissionCode)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  };
}

export function requireAnyPermission(permissionCodes) {
  return (req, res, next) => {
    const perms = req.authStaff?.permissionSet;
    const codes = Array.isArray(permissionCodes) ? permissionCodes : [permissionCodes];
    if (!perms || !codes.some((code) => perms.has(code))) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  };
}
