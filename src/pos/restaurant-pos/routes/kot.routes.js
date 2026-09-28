import { Router } from 'express';
import * as kotController from '../controllers/kot.controller.js';
import { requireFeature, requireAnyFeature } from '../../../middleware/entitlementMiddleware.js';

/**
 * Mounted at /api/pos/kot (after POS authMiddleware in pos.routes.js).
 * POST /save — save or append KOT
 * GET /:kotMasterId — Flutter-shaped { success, data }
 */
export const kotRouter = Router();

kotRouter.post('/save', requireFeature('pos.kot'), kotController.saveKot);
kotRouter.get('/list', requireFeature('pos.kot'), kotController.listKots);
kotRouter.post('/join', requireFeature('pos.kot'), kotController.joinKots);
kotRouter.post('/split', requireFeature('pos.kot'), kotController.splitKot);
kotRouter.post(
  '/:kotMasterId/cancel',
  requireFeature('pos.kot'),
  kotController.cancelKot,
);
kotRouter.post(
  '/:kotMasterId/items/cancel',
  requireAnyFeature(['pos.kot.item_cancel', 'pos.item_cancel', 'pos.kot']),
  kotController.cancelKotItems,
);
kotRouter.post(
  '/:kotMasterId/items/qty',
  requireAnyFeature(['pos.kot.item_cancel', 'pos.item_cancel', 'pos.kot']),
  kotController.updateKotItemQty,
);
kotRouter.post(
  '/:kotMasterId/covers',
  requireFeature('pos.kot'),
  kotController.updateKotCovers,
);
kotRouter.post(
  '/:kotMasterId/change-table',
  requireFeature('pos.kot'),
  kotController.changeKotTable,
);
kotRouter.get('/:kotMasterId', requireFeature('pos.kot'), kotController.getKot);
