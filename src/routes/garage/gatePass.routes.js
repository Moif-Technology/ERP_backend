import { Router } from 'express';
import * as ctrl from '../../controllers/garage/gatePass.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const gatePassRouter = Router();

gatePassRouter.use(authMiddleware);
gatePassRouter.get('/', ctrl.listGatePasses);
gatePassRouter.get('/:id', ctrl.getGatePassById);
gatePassRouter.post('/', ctrl.createGatePass);
