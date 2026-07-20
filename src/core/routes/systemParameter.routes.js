import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requirePermission } from '../../middleware/entitlementMiddleware.js';
import * as ctrl from '../controllers/systemParameter.controller.js';

export const systemParameterRouter = Router();

systemParameterRouter.use(authMiddleware);
systemParameterRouter.get('/',           requirePermission('core.settings.view'), ctrl.getAll);
systemParameterRouter.get('/:module',    requirePermission('core.settings.view'), ctrl.getModule);
systemParameterRouter.put('/:module',    requirePermission('core.settings.edit'), ctrl.updateModule);
