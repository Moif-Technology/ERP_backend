import { Router } from 'express';
import * as salesReturnEntryController from '../controllers/salesReturnEntry.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const salesReturnEntryRouter = Router();

salesReturnEntryRouter.use(authMiddleware);
salesReturnEntryRouter.use(requireFeature('backoffice.sales'));

salesReturnEntryRouter.post('/accounts/preview-draft', salesReturnEntryController.previewDraftSalesReturnAccounts);
salesReturnEntryRouter.get('/source', salesReturnEntryController.loadSourceSale);
salesReturnEntryRouter.get('/lookup', salesReturnEntryController.lookupSalesReturn);
salesReturnEntryRouter.get('/', salesReturnEntryController.listSalesReturns);
salesReturnEntryRouter.post('/', salesReturnEntryController.createSalesReturn);
salesReturnEntryRouter.get('/:salesId/accounts', salesReturnEntryController.getSalesReturnAccounts);
salesReturnEntryRouter.post('/:salesId/accounts/preview', salesReturnEntryController.previewSalesReturnAccounts);
salesReturnEntryRouter.get('/:salesId', salesReturnEntryController.getSalesReturn);
salesReturnEntryRouter.put('/:salesId', salesReturnEntryController.updateSalesReturn);
salesReturnEntryRouter.post('/:salesId/post', salesReturnEntryController.postSalesReturn);
salesReturnEntryRouter.post('/:salesId/unpost', salesReturnEntryController.unpostSalesReturn);
