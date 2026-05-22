import { Router } from 'express';
import * as ctrl from '../../controllers/garage/jobCard.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const jobCardRouter = Router();

jobCardRouter.use(authMiddleware);
jobCardRouter.get('/', ctrl.listJobCards);
jobCardRouter.get('/monitor/workshop', ctrl.workshopMonitor);
jobCardRouter.get('/:id', ctrl.getJobCardById);
jobCardRouter.post('/', ctrl.createJobCard);
jobCardRouter.put('/:id', ctrl.updateJobCard);
jobCardRouter.patch('/:id/workflow', ctrl.transitionJobCard);
jobCardRouter.patch('/:id/post', ctrl.postJobCard);
jobCardRouter.patch('/:id/unpost', ctrl.unpostJobCard);
jobCardRouter.post('/:id/deliver', ctrl.deliverVehicle);
jobCardRouter.patch('/:id/deliver', ctrl.deliverVehicle);
