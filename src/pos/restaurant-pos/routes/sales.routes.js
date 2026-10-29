import { Router } from 'express';
import * as salesController from '../controllers/sales.controller.js';
import { requireFeature, requireAnyFeature } from '../../../middleware/entitlementMiddleware.js';

/** Mounted at /api/pos/sales (after POS authMiddleware). */
export const salesRouter = Router();

salesRouter.get('/next-bill-no', requireFeature('pos.billing'), salesController.nextBillNo);
salesRouter.get(
  '/by-bill/:billNo',
  requireAnyFeature(['pos.settlement', 'pos.kot', 'pos']),
  salesController.getSaleByBill,
);
salesRouter.get(
  '/delivery-boy-orders',
  requireAnyFeature(['pos.settlement', 'pos.kot', 'pos']),
  salesController.deliveryBoyOrders,
);
salesRouter.post(
  '/delivery-night-settle',
  requireFeature('pos.settlement'),
  salesController.deliveryNightSettle,
);
salesRouter.get(
  '/credit-card-types',
  requireAnyFeature(['pos.settlement', 'pos']),
  salesController.listCreditCardTypes,
);
salesRouter.post(
  '/credit-card-types',
  requireAnyFeature(['pos.settlement', 'pos']),
  salesController.saveCreditCardType,
);
salesRouter.put(
  '/credit-card-types/:id',
  requireAnyFeature(['pos.settlement', 'pos']),
  salesController.saveCreditCardType,
);
salesRouter.post('/settle', requireFeature('pos.settlement'), salesController.settle);
salesRouter.get(
  '/reports/area-wise',
  requireAnyFeature(['pos.counter_reports', 'pos']),
  salesController.areaWiseReport,
);
salesRouter.get(
  '/reports/:kind',
  requireAnyFeature(['pos.counter_reports', 'pos.settlement', 'pos']),
  salesController.groupedSalesReport,
);
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
