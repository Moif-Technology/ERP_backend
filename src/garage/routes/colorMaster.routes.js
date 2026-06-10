import { Router } from 'express';
import * as ctrl from '../controllers/colorMaster.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const colorMasterRouter = Router();

colorMasterRouter.use(authMiddleware);
colorMasterRouter.get('/', ctrl.listColors);
colorMasterRouter.post('/', ctrl.createColor);
colorMasterRouter.delete('/:colorId', ctrl.deleteColor);
