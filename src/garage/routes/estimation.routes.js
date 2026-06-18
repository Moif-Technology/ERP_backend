import { Router } from 'express';
import * as ctrl from '../controllers/estimation.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const estimationRouter = Router();

estimationRouter.use(authMiddleware);
estimationRouter.get('/', ctrl.listEstimations);
estimationRouter.get('/:id', ctrl.getEstimationById);
estimationRouter.post('/', ctrl.createEstimation);
estimationRouter.put('/:id', ctrl.updateEstimation);
estimationRouter.patch('/:id/post', ctrl.postEstimation);
estimationRouter.patch('/:id/unpost', ctrl.unpostEstimation);
