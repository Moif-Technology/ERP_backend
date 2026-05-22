import { Router } from 'express';
import * as accountsParameterController from '../controllers/accountsParameter.controller.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/entitlementMiddleware.js';

export const accountsParameterRouter = Router();

accountsParameterRouter.use(authMiddleware);
accountsParameterRouter.use(requireFeature('backoffice.accounts'));
accountsParameterRouter.get('/branch-defaults', accountsParameterController.getBranchDefaults);
accountsParameterRouter.patch('/branch-defaults', accountsParameterController.patchBranchDefaults);
