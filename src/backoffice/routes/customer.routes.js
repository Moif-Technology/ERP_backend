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
// POS tills only ship with pos.customer_selection.view (cashier / stylist roles).
// Allow that permission for create/update so Customer Entry on Salon POS works;
// ledger posting stays restricted to backoffice edit rights.
customerRouter.post('/', requireAnyPermission(['core.customers.create', 'backoffice.customers.create', 'pos.customer_selection.view']), customerController.createCustomer);
customerRouter.post('/:customerId/post-ledger', requireAnyPermission(['core.customers.edit', 'backoffice.customers.edit']), customerController.postCustomerLedger);
customerRouter.put('/:customerId', requireAnyPermission(['core.customers.edit', 'backoffice.customers.edit', 'pos.customer_selection.view']), customerController.updateCustomer);
