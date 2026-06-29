import { Router } from 'express';
import * as customerController from '../controllers/customer.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const customerRouter = Router();

customerRouter.use(authMiddleware);
// core.customers is auto-enabled by the dependency graph whenever garage, crm,
// pos.billing, backoffice.sales, or any other consumer module is active.
customerRouter.use(requireAnyFeature(['core.customers', 'backoffice.customers', 'pos.customer_selection']));
customerRouter.get('/', customerController.listCustomers);
customerRouter.post('/', customerController.createCustomer);
customerRouter.post('/:customerId/post-ledger', customerController.postCustomerLedger);
customerRouter.put('/:customerId', customerController.updateCustomer);
