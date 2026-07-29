import { Router } from 'express';
import * as groupController from '../controllers/group.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const groupRouter = Router();

groupRouter.use(authMiddleware);
groupRouter.use(requireAnyFeature(['backoffice.product_group', 'pos.product_search']));
groupRouter.get('/next-code', groupController.nextGroupCode);
groupRouter.get('/', groupController.listGroups);
groupRouter.post('/', groupController.createGroup);
groupRouter.patch('/:groupId', groupController.updateGroup);
groupRouter.delete('/:groupId', groupController.deleteGroup);
