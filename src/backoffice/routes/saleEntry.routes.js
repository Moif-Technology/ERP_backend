import { Router } from 'express';
import * as saleEntryController from '../controllers/saleEntry.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const saleEntryRouter = Router();

saleEntryRouter.use(authMiddleware);
saleEntryRouter.use(requireFeature('backoffice.sales'));
saleEntryRouter.get('/', saleEntryController.listSales);
saleEntryRouter.post('/', saleEntryController.createSale);
