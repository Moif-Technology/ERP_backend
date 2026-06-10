import { Router } from 'express';
import * as subGroupController from '../controllers/subGroup.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const subGroupRouter = Router();

subGroupRouter.use(authMiddleware);
subGroupRouter.use(requireAnyFeature(['backoffice.product_group', 'pos.product_search']));
subGroupRouter.get('/', subGroupController.listSubGroups);
subGroupRouter.post('/', subGroupController.createSubGroup);
