import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import * as vanController from './controllers/van.controller.js';

export const vanRouter = Router();

vanRouter.post('/login', vanController.login);

vanRouter.use(authMiddleware);

vanRouter.get('/dashboard', vanController.dashboard);
vanRouter.get('/day-summary', vanController.daySummary);
vanRouter.get('/customers', vanController.customers);
vanRouter.get('/products', vanController.products);
vanRouter.get('/payment-accounts', vanController.paymentAccounts);
vanRouter.post('/sales', vanController.createSale);
