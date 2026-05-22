import { Router } from 'express';
import * as ctrl from '../../controllers/garage/vehicleMaster.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const vehicleMasterRouter = Router();

vehicleMasterRouter.use(authMiddleware);
vehicleMasterRouter.get('/', ctrl.listVehicles);
vehicleMasterRouter.get('/:id', ctrl.getVehicleById);
vehicleMasterRouter.post('/', ctrl.createVehicle);
vehicleMasterRouter.put('/:id', ctrl.updateVehicle);
