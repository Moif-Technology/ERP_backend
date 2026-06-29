import { Router } from 'express';
import * as accountHeadController from '../controllers/accountHead.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const accountHeadRouter = Router();

accountHeadRouter.use(authMiddleware);
accountHeadRouter.use(requireAnyFeature(['backoffice.accounts', 'accounts', 'accounts.ledger', 'accounts.vouchers']));
accountHeadRouter.get('/', accountHeadController.listAccountHeads);
accountHeadRouter.get('/tree', accountHeadController.getAccountTree);
accountHeadRouter.get('/suggest-number', accountHeadController.suggestAccountNumber);
accountHeadRouter.post('/seed-standard-chart', accountHeadController.seedStandardChart);
accountHeadRouter.get('/:accountId', accountHeadController.getAccountHead);
accountHeadRouter.post('/', accountHeadController.createAccountHead);
accountHeadRouter.put('/:accountId', accountHeadController.updateAccountHead);
accountHeadRouter.delete('/:accountId', accountHeadController.deleteAccountHead);
