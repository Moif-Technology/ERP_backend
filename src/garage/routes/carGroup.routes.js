import { Router } from 'express';
import * as ctrl from '../controllers/carGroup.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const carGroupRouter = Router();

carGroupRouter.use(authMiddleware);
carGroupRouter.get('/',           ctrl.listCarGroups);
carGroupRouter.post('/',          ctrl.createCarGroup);
carGroupRouter.delete('/:carGroupId', ctrl.deleteCarGroup);
