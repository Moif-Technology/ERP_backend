import { Router } from 'express';
import * as ctrl from '../controllers/subletLpo.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const subletLpoRouter = Router();

subletLpoRouter.use(authMiddleware);
subletLpoRouter.get('/', ctrl.listSubletLpos);
subletLpoRouter.get('/:id', ctrl.getSubletLpoById);
subletLpoRouter.post('/', ctrl.createSubletLpo);
subletLpoRouter.put('/:id', ctrl.updateSubletLpo);
subletLpoRouter.post('/:id/post', ctrl.postSubletLpo);
subletLpoRouter.patch('/:id/post', ctrl.postSubletLpo);
