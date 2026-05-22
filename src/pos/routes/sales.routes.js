import { Router } from 'express';
import * as salesController from '../controllers/sales.controller.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

/** Mounted at /api/pos/sales (after POS authMiddleware). */
export const salesRouter = Router();

salesRouter.post('/settle', requireFeature('pos.settlement'), salesController.settle);
