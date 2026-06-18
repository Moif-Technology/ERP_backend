import { Router } from 'express';
import * as ctrl from '../controllers/garageDashboard.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const garageDashboardRouter = Router();

garageDashboardRouter.use(authMiddleware);
garageDashboardRouter.get('/', ctrl.getDashboardKpis);
