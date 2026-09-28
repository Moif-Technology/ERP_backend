import { Router } from 'express';
import * as stockEntryController from '../controllers/stockEntry.controller.js';
import { requireAnyFeature } from '../../../middleware/entitlementMiddleware.js';

/** Mounted at /api/pos/stock-entry (after POS authMiddleware). */
export const stockEntryRouter = Router();

const feat = requireAnyFeature(['pos.counter_reports', 'pos']);

stockEntryRouter.get('/products', feat, stockEntryController.searchProducts);
stockEntryRouter.get('/draft-entered-qty', feat, stockEntryController.draftEnteredQty);
stockEntryRouter.get('/', feat, stockEntryController.listEntries);
stockEntryRouter.post('/', feat, stockEntryController.saveEntry);
stockEntryRouter.get('/:id', feat, stockEntryController.getEntry);
stockEntryRouter.post('/:id/post', feat, stockEntryController.postEntry);
stockEntryRouter.delete('/:id', feat, stockEntryController.deleteEntry);
