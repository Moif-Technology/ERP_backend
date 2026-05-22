import { Router } from 'express';
import * as kotController from '../controllers/kot.controller.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

/**
 * Mounted at /api/pos/kot (after POS authMiddleware in pos.routes.js).
 * POST /save — save or append KOT
 * GET /:kotMasterId — Flutter-shaped { success, data }
 */
export const kotRouter = Router();

kotRouter.post('/save', requireFeature('pos.kot'), kotController.saveKot);
kotRouter.get('/list', requireFeature('pos.kot'), kotController.listKots);
kotRouter.get('/:kotMasterId', requireFeature('pos.kot'), kotController.getKot);
