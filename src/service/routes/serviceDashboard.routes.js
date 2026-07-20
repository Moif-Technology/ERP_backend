import { Router } from 'express';
import * as ctrl from '../controllers/serviceDashboard.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const serviceDashboardRouter = Router();
serviceDashboardRouter.use(authMiddleware);
serviceDashboardRouter.use(requireFeature('service.dashboard'));
serviceDashboardRouter.get('/', ctrl.getDashboard);

export const serviceExpiryRouter = Router();
serviceExpiryRouter.use(authMiddleware);
serviceExpiryRouter.use(requireFeature('service.expiry'));
serviceExpiryRouter.get('/', ctrl.getExpiryBuckets);
