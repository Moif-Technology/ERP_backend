import { Router } from 'express';
import * as accountHeadController from '../controllers/accountHead.controller.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/entitlementMiddleware.js';

export const accountHeadRouter = Router();

accountHeadRouter.use(authMiddleware);
accountHeadRouter.use(requireFeature('backoffice.accounts'));
accountHeadRouter.get('/', accountHeadController.listAccountHeads);
accountHeadRouter.get('/tree', accountHeadController.getAccountTree);
accountHeadRouter.get('/:accountId', accountHeadController.getAccountHead);
accountHeadRouter.post('/', accountHeadController.createAccountHead);
accountHeadRouter.put('/:accountId', accountHeadController.updateAccountHead);
accountHeadRouter.delete('/:accountId', accountHeadController.deleteAccountHead);
