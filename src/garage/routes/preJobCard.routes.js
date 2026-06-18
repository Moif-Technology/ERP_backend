import { Router } from 'express';
import * as ctrl from '../controllers/preJobCard.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const preJobCardRouter = Router();

preJobCardRouter.use(authMiddleware);
preJobCardRouter.get('/', ctrl.listPreJobCards);
preJobCardRouter.get('/search', ctrl.searchByRegNo);
preJobCardRouter.get('/:id', ctrl.getPreJobCardById);
preJobCardRouter.post('/', ctrl.createPreJobCard);
preJobCardRouter.put('/:id', ctrl.updatePreJobCard);
