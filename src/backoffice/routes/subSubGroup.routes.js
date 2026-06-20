import { Router } from 'express';
import * as subSubGroupController from '../controllers/subSubGroup.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const subSubGroupRouter = Router();

subSubGroupRouter.use(authMiddleware);
subSubGroupRouter.use(requireAnyFeature(['backoffice.sub_sub_group', 'backoffice.product_group', 'pos.product_search']));
subSubGroupRouter.get('/', subSubGroupController.listSubSubGroups);
subSubGroupRouter.post('/', subSubGroupController.createSubSubGroup);
