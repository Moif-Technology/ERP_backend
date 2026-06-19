import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import * as appParameterController from '../controllers/appParameter.controller.js';

export const appParameterRouter = Router();

appParameterRouter.use(authMiddleware);
appParameterRouter.get('/gvtax', appParameterController.getGvTax);
