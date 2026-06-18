import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import * as ctrl from '../controllers/featureAdmin.controller.js';

export const featureAdminRouter = Router();

featureAdminRouter.use(authMiddleware);

featureAdminRouter.get('/matrix', ctrl.getFeatureMatrix);
featureAdminRouter.put('/plan/:planCode', ctrl.updatePlanFeatures);
