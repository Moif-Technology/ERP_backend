import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requirePermission } from '../../middleware/entitlementMiddleware.js';
import * as ctrl from '../controllers/featureAdmin.controller.js';

export const featureAdminRouter = Router();

featureAdminRouter.use(authMiddleware);

featureAdminRouter.get('/matrix', requirePermission('core.settings.view'), ctrl.getFeatureMatrix);
featureAdminRouter.put('/plan/:planCode', requirePermission('core.settings.edit'), ctrl.updatePlanFeatures);
