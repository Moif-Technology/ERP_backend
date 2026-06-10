import { Router } from 'express';
import * as customerController from '../controllers/customer.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const customerRouter = Router();

customerRouter.use(authMiddleware);
customerRouter.use(requireAnyFeature(['core.customers', 'backoffice.customers', 'pos.customer_selection', 'crm']));
customerRouter.get('/', customerController.listCustomers);
customerRouter.post('/', customerController.createCustomer);
customerRouter.put('/:customerId', customerController.updateCustomer);
