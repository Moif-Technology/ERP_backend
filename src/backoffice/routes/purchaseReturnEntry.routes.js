import { Router } from 'express';
import * as purchaseReturnEntryController from '../controllers/purchaseReturnEntry.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const purchaseReturnEntryRouter = Router();

purchaseReturnEntryRouter.use(authMiddleware);
purchaseReturnEntryRouter.use(requireFeature('backoffice.purchase'));

purchaseReturnEntryRouter.post('/accounts/preview-draft', purchaseReturnEntryController.previewDraftPurchaseReturnAccounts);
purchaseReturnEntryRouter.get('/source', purchaseReturnEntryController.loadSourcePurchase);
purchaseReturnEntryRouter.get('/lookup', purchaseReturnEntryController.lookupPurchaseReturn);
purchaseReturnEntryRouter.get('/', purchaseReturnEntryController.listPurchaseReturns);
purchaseReturnEntryRouter.post('/', purchaseReturnEntryController.createPurchaseReturn);
purchaseReturnEntryRouter.get('/:purchaseId/accounts', purchaseReturnEntryController.getPurchaseReturnAccounts);
purchaseReturnEntryRouter.post('/:purchaseId/accounts/preview', purchaseReturnEntryController.previewPurchaseReturnAccounts);
purchaseReturnEntryRouter.get('/:purchaseId', purchaseReturnEntryController.getPurchaseReturn);
purchaseReturnEntryRouter.put('/:purchaseId', purchaseReturnEntryController.updatePurchaseReturn);
purchaseReturnEntryRouter.post('/:purchaseId/post', purchaseReturnEntryController.postPurchaseReturn);
purchaseReturnEntryRouter.post('/:purchaseId/unpost', purchaseReturnEntryController.unpostPurchaseReturn);
