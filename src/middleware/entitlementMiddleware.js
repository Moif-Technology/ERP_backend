export function requireActiveSubscription() {
  return (req, res, next) => next();
}

export function requireFeature(_featureCode) {
  return (req, res, next) => next();
}

export function requireAnyFeature(_featureCodes) {
  return (req, res, next) => next();
}

export function requirePermission(_permissionCode) {
  return (req, res, next) => next();
}
