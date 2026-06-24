import { Router } from 'express';
import * as saleEntryController from '../controllers/saleEntry.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const saleEntryRouter = Router();

saleEntryRouter.use(authMiddleware);
saleEntryRouter.use(requireFeature('backoffice.sales'));
saleEntryRouter.post('/accounts/preview-draft', saleEntryController.previewSaleAccountsDraft);
saleEntryRouter.get('/line-product-details', saleEntryController.getSaleLineProductDetails);
saleEntryRouter.get('/', saleEntryController.listSales);
saleEntryRouter.get('/:salesId', saleEntryController.getSaleById);
saleEntryRouter.post('/', saleEntryController.createSale);
saleEntryRouter.put('/:salesId', saleEntryController.updateSale);
saleEntryRouter.post('/:salesId/post', saleEntryController.postSale);
saleEntryRouter.post('/:salesId/unpost', saleEntryController.unpostSale);
saleEntryRouter.get('/:salesId/accounts', saleEntryController.getSaleAccounts);
saleEntryRouter.post('/:salesId/accounts/preview', saleEntryController.previewSaleAccounts);
