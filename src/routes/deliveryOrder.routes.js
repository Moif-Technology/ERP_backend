import { Router } from 'express';
import * as deliveryOrderController from '../controllers/deliveryOrder.controller.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/entitlementMiddleware.js';

export const deliveryOrderRouter = Router();

deliveryOrderRouter.use(authMiddleware);
deliveryOrderRouter.use(requireFeature('backoffice.delivery_order'));
deliveryOrderRouter.post('/', deliveryOrderController.createDeliveryOrder);
deliveryOrderRouter.get('/', deliveryOrderController.listDeliveryOrders);
deliveryOrderRouter.get('/:deliveryOrderId', deliveryOrderController.getDeliveryOrder);
