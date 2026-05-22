import { Router } from 'express';
import * as ctrl from '../../controllers/garage/technician.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const technicianRouter = Router();

technicianRouter.use(authMiddleware);
technicianRouter.get('/', ctrl.listTechnicians);
technicianRouter.get('/:id', ctrl.getTechnicianById);
technicianRouter.post('/', ctrl.createTechnician);
technicianRouter.put('/:id', ctrl.updateTechnician);
technicianRouter.delete('/:id', ctrl.deleteTechnician);
