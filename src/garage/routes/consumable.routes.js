import { Router } from 'express';
import * as ctrl from '../controllers/consumable.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const consumableRouter = Router();

consumableRouter.use(authMiddleware);
consumableRouter.get('/', ctrl.listConsumables);
consumableRouter.get('/:id', ctrl.getConsumableById);
consumableRouter.post('/', ctrl.createConsumable);
consumableRouter.put('/:id', ctrl.updateConsumable);
consumableRouter.delete('/:id', ctrl.deleteConsumable);
