import { Router } from 'express';
import {
  requirePlatformAuth,
  requireCapability,
} from '../../middleware/platformAuth.middleware.js';
import * as ctrl from '../controllers/tenant.controller.js';

export const tenantAdminRouter = Router();

tenantAdminRouter.use(requirePlatformAuth);

tenantAdminRouter.get('/', requireCapability('tenant.read'), ctrl.list);
tenantAdminRouter.get('/:companyId', requireCapability('tenant.read'), ctrl.detail);
tenantAdminRouter.get('/:companyId/features', requireCapability('tenant.read'), ctrl.getFeatures);
tenantAdminRouter.get('/:companyId/audit', requireCapability('audit.read'), ctrl.audit);

tenantAdminRouter.patch(
  '/:companyId/subscription',
  requireCapability('tenant.subscription.update'),
  ctrl.patchSubscription
);
tenantAdminRouter.put(
  '/:companyId/features',
  requireCapability('tenant.feature.toggle'),
  ctrl.setFeature
);
tenantAdminRouter.delete(
  '/:companyId/features/:featureCode',
  requireCapability('tenant.feature.toggle'),
  ctrl.clearFeature
);
tenantAdminRouter.put(
  '/:companyId/limits',
  requireCapability('tenant.limit.update'),
  ctrl.setLimit
);
tenantAdminRouter.delete(
  '/:companyId/limits/:limitCode',
  requireCapability('tenant.limit.update'),
  ctrl.clearLimit
);
tenantAdminRouter.post(
  '/:companyId/suspend',
  requireCapability('tenant.suspend'),
  ctrl.suspend
);
tenantAdminRouter.post(
  '/:companyId/reactivate',
  requireCapability('tenant.reactivate'),
  ctrl.reactivate
);
tenantAdminRouter.post(
  '/:companyId/extend-trial',
  requireCapability('tenant.extend_trial'),
  ctrl.extendTrial
);
