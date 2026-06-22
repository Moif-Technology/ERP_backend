import { Router } from 'express';
import * as purchaseEntryController from '../controllers/purchaseEntry.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const purchaseEntryRouter = Router();

purchaseEntryRouter.use(authMiddleware);
purchaseEntryRouter.use(requireFeature('backoffice.purchase'));
purchaseEntryRouter.post('/', purchaseEntryController.createPurchase);
purchaseEntryRouter.get('/', purchaseEntryController.listPurchases);
purchaseEntryRouter.get('/lookup', purchaseEntryController.lookupPurchase);
purchaseEntryRouter.get('/:purchaseId', purchaseEntryController.getPurchase);
purchaseEntryRouter.put('/:purchaseId', purchaseEntryController.updatePurchase);
purchaseEntryRouter.post('/:purchaseId/post', purchaseEntryController.postPurchase);
purchaseEntryRouter.post('/:purchaseId/unpost', purchaseEntryController.unpostPurchase);
purchaseEntryRouter.get('/:purchaseId/accounts', purchaseEntryController.getPurchaseAccounts);
purchaseEntryRouter.post('/:purchaseId/accounts/preview', purchaseEntryController.previewPurchaseAccounts);
