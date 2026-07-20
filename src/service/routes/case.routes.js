import { Router } from 'express';
import * as ctrl from '../controllers/case.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const serviceCaseRouter = Router();
serviceCaseRouter.use(authMiddleware);
serviceCaseRouter.use(requireFeature('service.cases'));

serviceCaseRouter.get('/', ctrl.list);
serviceCaseRouter.get('/:id', ctrl.getById);
serviceCaseRouter.post('/', ctrl.create);
serviceCaseRouter.put('/:id', ctrl.update);
serviceCaseRouter.patch('/:id/status', ctrl.updateStatus);

serviceCaseRouter.patch('/:id/tasks/:taskId', ctrl.updateTask);

serviceCaseRouter.post('/:id/documents', ctrl.addDocument);
serviceCaseRouter.patch('/:id/documents/:documentId', ctrl.updateDocument);

serviceCaseRouter.post('/:id/payments', ctrl.addPayment);
