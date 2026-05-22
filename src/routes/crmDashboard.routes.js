import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/entitlementMiddleware.js';
import { getDashboard } from '../controllers/crmDashboard.controller.js';

export const crmDashboardRouter = Router();
crmDashboardRouter.use(authMiddleware);
crmDashboardRouter.use(requireFeature('crm.dashboard'));
crmDashboardRouter.get('/', getDashboard);
