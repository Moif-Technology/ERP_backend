import { Router } from 'express';
import * as ctrl from '../controllers/carSubGroup.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const carSubGroupRouter = Router();

carSubGroupRouter.use(authMiddleware);
carSubGroupRouter.get('/',                 ctrl.listCarSubGroups);
carSubGroupRouter.post('/',                ctrl.createCarSubGroup);
carSubGroupRouter.delete('/:carSubGroupId', ctrl.deleteCarSubGroup);
