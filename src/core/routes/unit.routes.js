import { Router } from 'express';
import * as unitController from '../controllers/unit.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const unitRouter = Router();

unitRouter.use(authMiddleware);
unitRouter.get(
  '/',
  requireAnyFeature(['backoffice.product_master', 'backoffice.purchase', 'backoffice.grn', 'pos.product_search']),
  unitController.listUnits
);
