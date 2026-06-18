import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import * as ctrl from '../controllers/systemParameter.controller.js';

export const systemParameterRouter = Router();

systemParameterRouter.use(authMiddleware);
systemParameterRouter.get('/',           ctrl.getAll);
systemParameterRouter.get('/:module',    ctrl.getModule);
systemParameterRouter.put('/:module',    ctrl.updateModule);
