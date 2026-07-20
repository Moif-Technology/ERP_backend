import { Router } from 'express';
import * as ctrl from '../controllers/service.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const serviceCatalogueRouter = Router();
serviceCatalogueRouter.use(authMiddleware);
serviceCatalogueRouter.use(requireFeature('service.categories'));
serviceCatalogueRouter.get('/', ctrl.list);
serviceCatalogueRouter.get('/:id', ctrl.getById);
serviceCatalogueRouter.post('/', ctrl.create);
serviceCatalogueRouter.put('/:id', ctrl.update);
serviceCatalogueRouter.delete('/:id', ctrl.remove);
