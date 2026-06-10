import { Router } from 'express';
import { workshopMonitor } from '../controllers/jobCard.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const workshopMonitorRouter = Router();

workshopMonitorRouter.use(authMiddleware);
workshopMonitorRouter.get('/', workshopMonitor);
