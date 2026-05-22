import { Router } from 'express';
import * as purchaseEntryController from '../controllers/purchaseEntry.controller.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/entitlementMiddleware.js';

export const purchaseEntryRouter = Router();

purchaseEntryRouter.use(authMiddleware);
purchaseEntryRouter.use(requireFeature('backoffice.purchase'));
purchaseEntryRouter.post('/', purchaseEntryController.createPurchase);
purchaseEntryRouter.get('/', purchaseEntryController.listPurchases);
