import { Router } from 'express';
import * as ctrl from '../controllers/subletJob.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const subletJobRouter = Router();

subletJobRouter.use(authMiddleware);
subletJobRouter.get('/', ctrl.listSubletJobs);
subletJobRouter.get('/:id', ctrl.getSubletJobById);
subletJobRouter.post('/', ctrl.createSubletJob);
subletJobRouter.put('/:id', ctrl.updateSubletJob);
subletJobRouter.post('/:id/post', ctrl.postSubletJob);
subletJobRouter.patch('/:id/post', ctrl.postSubletJob);
subletJobRouter.post('/:id/cancel', ctrl.cancelSubletJob);
subletJobRouter.patch('/:id/cancel', ctrl.cancelSubletJob);
