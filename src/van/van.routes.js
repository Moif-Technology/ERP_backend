import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/entitlementMiddleware.js';
import * as vanController from './controllers/van.controller.js';

export const vanRouter = Router();

vanRouter.post('/login', vanController.login);

vanRouter.use(authMiddleware);

vanRouter.get('/dashboard',          requireFeature('van.dashboard'),    vanController.dashboard);
vanRouter.get('/day-summary',        requireFeature('van.day_summary'),  vanController.daySummary);
vanRouter.get('/customers',          requireFeature('van.customers'),    vanController.customers);
vanRouter.get('/products',           requireFeature('van.products'),     vanController.products);
vanRouter.get('/payment-accounts',   requireFeature('van.sales'),        vanController.paymentAccounts);
vanRouter.post('/sales',             requireFeature('van.sales'),        vanController.createSale);
vanRouter.get('/vans',               requireFeature('van.van_master'),   vanController.vans);
vanRouter.get('/routes',             requireFeature('van.route_master'), vanController.routes);
vanRouter.get('/assignment/today',   requireFeature('van.assignment'),   vanController.todayAssignment);
vanRouter.post('/assignment',        requireFeature('van.assignment'),   vanController.startDay);
