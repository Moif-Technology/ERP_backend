import { Router } from 'express';
import * as ctrl from '../controllers/case.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const serviceTaskBoardRouter = Router();
serviceTaskBoardRouter.use(authMiddleware);
serviceTaskBoardRouter.use(requireFeature('service.tasks'));
serviceTaskBoardRouter.get('/', ctrl.listTaskBoard);
