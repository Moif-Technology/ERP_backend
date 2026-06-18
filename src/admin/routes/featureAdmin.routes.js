import { Router } from 'express';
import { requirePlatformAuth } from '../../middleware/platformAuth.middleware.js';
import * as ctrl from '../../core/controllers/featureAdmin.controller.js';

export const adminFeatureRouter = Router();

adminFeatureRouter.use(requirePlatformAuth);

adminFeatureRouter.get('/matrix', ctrl.getFeatureMatrix);
adminFeatureRouter.put('/plan/:planCode', ctrl.updatePlanFeatures);
adminFeatureRouter.get('/plans', ctrl.listPlans);
adminFeatureRouter.post('/plans', ctrl.upsertPlan);
adminFeatureRouter.delete('/plans/:planCode', ctrl.deletePlan);
