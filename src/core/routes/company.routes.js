import { Router } from 'express';
import * as companyController from '../controllers/company.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const companyRouter = Router();

companyRouter.use(authMiddleware);
companyRouter.get('/profile', companyController.getProfile);
companyRouter.put('/profile', companyController.updateProfile);
