import { Router } from 'express';
import * as ctrl from '../controllers/stockTransfer.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const stockTransferRouter = Router();

// pos.stock_transfer is the catalogued transfer feature; backoffice.stock_entry
// lets backoffice-only plans use it like the other Stock Hub documents.
const transferFeature = requireAnyFeature(['pos.stock_transfer', 'backoffice.stock_entry']);

stockTransferRouter.use(authMiddleware);

stockTransferRouter.get('/',            transferFeature, ctrl.listTransfers);
stockTransferRouter.post('/',           transferFeature, ctrl.createTransfer);
stockTransferRouter.get('/stock',       transferFeature, ctrl.getStockAtBranch);
stockTransferRouter.get('/:id',         transferFeature, ctrl.getTransfer);
stockTransferRouter.put('/:id',         transferFeature, ctrl.updateTransfer);
stockTransferRouter.post('/:id/post',   transferFeature, ctrl.postTransfer);
stockTransferRouter.post('/:id/cancel', transferFeature, ctrl.cancelTransfer);
