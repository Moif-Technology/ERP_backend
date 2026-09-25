import { Router } from 'express';
import * as inventoryReportController from '../controllers/inventoryReport.controller.js';
import { requireAnyFeature } from '../../../middleware/entitlementMiddleware.js';

/** Mounted at /api/pos/inventory (after POS authMiddleware). */
export const inventoryRouter = Router();

inventoryRouter.get(
  '/lookups',
  requireAnyFeature(['pos.counter_reports', 'pos']),
  inventoryReportController.lookups,
);

inventoryRouter.get(
  '/report',
  requireAnyFeature(['pos.counter_reports', 'pos']),
  inventoryReportController.report,
);

inventoryRouter.get(
  '/movement',
  requireAnyFeature(['pos.counter_reports', 'pos']),
  inventoryReportController.movement,
);
