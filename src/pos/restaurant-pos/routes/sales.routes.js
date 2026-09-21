import { Router } from 'express';
import * as salesController from '../controllers/sales.controller.js';
import { requireFeature, requireAnyFeature } from '../../../middleware/entitlementMiddleware.js';

/** Mounted at /api/pos/sales (after POS authMiddleware). */
export const salesRouter = Router();

salesRouter.get(
  '/by-bill/:billNo',
  requireAnyFeature(['pos.settlement', 'pos.kot', 'pos']),
  salesController.getSaleByBill,
);
salesRouter.post('/settle', requireFeature('pos.settlement'), salesController.settle);
salesRouter.get(
  '/viewer',
  requireAnyFeature(['pos.counter_reports', 'pos.settlement', 'pos']),
  salesController.salesViewerList,
);
salesRouter.get(
  '/viewer/:salesId',
  requireAnyFeature(['pos.counter_reports', 'pos.settlement', 'pos']),
  salesController.salesViewerBill,
);
