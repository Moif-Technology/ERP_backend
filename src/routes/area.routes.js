import { Router } from 'express';
import * as areaController from '../controllers/area.controller.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAnyFeature } from '../middleware/entitlementMiddleware.js';

export const areaRouter = Router();

areaRouter.use(authMiddleware);
areaRouter.use(requireAnyFeature(['backoffice.area_master', 'pos.areas']));
areaRouter.get('/', areaController.listAreas);
areaRouter.post('/', areaController.createArea);
