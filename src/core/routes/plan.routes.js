import { Router } from 'express';
import * as planController from '../controllers/plan.controller.js';

export const planRouter = Router();

planRouter.get('/', planController.listPlans);
planRouter.get('/registration-options', planController.getRegistrationOptions);
