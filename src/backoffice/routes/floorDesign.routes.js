import { Router } from 'express';
import * as floorDesignController from '../controllers/floorDesign.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const floorDesignRouter = Router();

floorDesignRouter.use(authMiddleware);
floorDesignRouter.get(
  '/:areaId',
  requireAnyFeature(['backoffice.table_master', 'pos.tables', 'pos.kot']),
  floorDesignController.getFloorDesign,
);
floorDesignRouter.put(
  '/:areaId',
  requireAnyFeature(['backoffice.table_master', 'pos.tables']),
  floorDesignController.saveFloorDesign,
);
