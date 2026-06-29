import { Router } from 'express';
import * as accountsParameterController from '../controllers/accountsParameter.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const accountsParameterRouter = Router();

accountsParameterRouter.use(authMiddleware);
accountsParameterRouter.use(requireAnyFeature(['backoffice.accounts', 'accounts', 'accounts.ledger', 'accounts.vouchers']));
accountsParameterRouter.get('/branch-defaults', accountsParameterController.getBranchDefaults);
accountsParameterRouter.patch('/branch-defaults', accountsParameterController.patchBranchDefaults);
accountsParameterRouter.get('/integration', accountsParameterController.getBranchIntegration);
accountsParameterRouter.patch('/integration', accountsParameterController.patchBranchIntegration);
