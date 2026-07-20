import { Router } from 'express';
import * as customerController from '../controllers/customer.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature, requireAnyPermission } from '../../middleware/entitlementMiddleware.js';

export const customerRouter = Router();

customerRouter.use(authMiddleware);
// core.customers is auto-enabled by the dependency graph whenever garage, crm,
// pos.billing, backoffice.sales, or any other consumer module is active.
customerRouter.use(requireAnyFeature(['core.customers', 'backoffice.customers', 'pos.customer_selection']));
customerRouter.get('/', requireAnyPermission(['core.customers.view', 'backoffice.customers.view', 'pos.customer_selection.view']), customerController.listCustomers);
customerRouter.post('/', requireAnyPermission(['core.customers.create', 'backoffice.customers.create']), customerController.createCustomer);
customerRouter.post('/:customerId/post-ledger', requireAnyPermission(['core.customers.edit', 'backoffice.customers.edit']), customerController.postCustomerLedger);
customerRouter.put('/:customerId', requireAnyPermission(['core.customers.edit', 'backoffice.customers.edit']), customerController.updateCustomer);
