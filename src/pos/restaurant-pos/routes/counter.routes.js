import { Router } from 'express';
import * as counterController from '../controllers/counter.controller.js';
import { requireAnyFeature } from '../../../middleware/entitlementMiddleware.js';

/** Mounted at /api/pos/counter */
export const counterRouter = Router();

counterRouter.get(
  '/summary',
  requireAnyFeature(['pos.counter_open_close', 'pos.counter_reports', 'pos']),
  counterController.getSummary,
);
counterRouter.post(
  '/close',
  requireAnyFeature(['pos.counter_open_close', 'pos.counter_reports', 'pos']),
  counterController.closeCounter,
);
