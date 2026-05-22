import { Router } from 'express';
import * as ctrl from '../controllers/stockEntry.controller.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAnyFeature, requireFeature } from '../middleware/entitlementMiddleware.js';

export const stockEntryRouter = Router();

stockEntryRouter.use(authMiddleware);

stockEntryRouter.get('/',                  requireFeature('backoffice.stock_entry'), ctrl.listEntries);
stockEntryRouter.post('/',                 requireFeature('backoffice.stock_entry'), ctrl.saveEntry);
stockEntryRouter.get('/reorder',           requireFeature('backoffice.reorder'), ctrl.getReorderList);
stockEntryRouter.get('/draft-entered-qty', requireAnyFeature(['backoffice.stock_entry', 'backoffice.inventory']), ctrl.getDraftEnteredQty);
stockEntryRouter.get('/movement',          requireFeature('backoffice.product_movement'), ctrl.getProductMovement);
stockEntryRouter.get('/:id',               requireFeature('backoffice.stock_entry'), ctrl.getEntry);
stockEntryRouter.put('/:id',               requireFeature('backoffice.stock_entry'), ctrl.saveEntry);
stockEntryRouter.post('/:id/post',         requireFeature('backoffice.stock_entry'), ctrl.postEntry);
stockEntryRouter.post('/:id/unpost',       requireFeature('backoffice.stock_entry'), ctrl.unpostEntry);
stockEntryRouter.delete('/:id',            requireFeature('backoffice.stock_entry'), ctrl.deleteEntry);
