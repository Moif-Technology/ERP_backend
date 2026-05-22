import { Router } from 'express';
import * as ctrl from '../../controllers/garage/jobDescription.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const jobDescriptionRouter = Router();

jobDescriptionRouter.use(authMiddleware);
jobDescriptionRouter.get('/', ctrl.listJobDescriptions);
jobDescriptionRouter.get('/:id', ctrl.getJobDescriptionById);
jobDescriptionRouter.post('/', ctrl.createJobDescription);
jobDescriptionRouter.put('/:id', ctrl.updateJobDescription);
jobDescriptionRouter.delete('/:id', ctrl.deleteJobDescription);
