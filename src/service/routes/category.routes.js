import { Router } from 'express';
import * as ctrl from '../controllers/category.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const serviceCategoryRouter = Router();
serviceCategoryRouter.use(authMiddleware);
serviceCategoryRouter.use(requireFeature('service.categories'));
serviceCategoryRouter.get('/', ctrl.list);
serviceCategoryRouter.get('/:id', ctrl.getById);
serviceCategoryRouter.post('/', ctrl.create);
serviceCategoryRouter.put('/:id', ctrl.update);
serviceCategoryRouter.delete('/:id', ctrl.remove);
