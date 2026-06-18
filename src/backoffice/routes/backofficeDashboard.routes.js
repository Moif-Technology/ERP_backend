import { Router } from 'express';
import * as controller from '../controllers/backofficeDashboard.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const backofficeDashboardRouter = Router();

backofficeDashboardRouter.use(authMiddleware);
backofficeDashboardRouter.get('/backoffice', requireAnyFeature(['backoffice.dashboard', 'pos']), controller.getBackofficeDashboard);
backofficeDashboardRouter.get('/basic', requireAnyFeature(['backoffice.dashboard', 'pos']), controller.getBackofficeDashboard);
backofficeDashboardRouter.get('/overview', requireAnyFeature(['backoffice.dashboard', 'pos', 'crm.dashboard', 'garage', 'hr.dashboard']), controller.getUnifiedDashboard);
