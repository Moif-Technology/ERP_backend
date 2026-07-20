import { Router } from 'express';
import * as ctrl from '../controllers/case.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const servicePaymentsRouter = Router();
servicePaymentsRouter.use(authMiddleware);
servicePaymentsRouter.use(requireFeature('service.payments'));
servicePaymentsRouter.get('/', ctrl.listAllPayments);
