import { Router } from 'express';
import * as authController     from './controllers/auth.controller.js';
import * as productController  from './controllers/product.controller.js';
import * as customerController from './controllers/customer.controller.js';
import * as salesController    from './controllers/sales.controller.js';
import * as groupController    from './controllers/group.controller.js';
import * as counterController     from './controllers/counter.controller.js';
import * as settlementController  from './controllers/settlement.controller.js';
import { authMiddleware }         from '../../middleware/authMiddleware.js';
import { requireFeature, requirePermission } from '../../middleware/entitlementMiddleware.js';

export const counterPosRouter = Router();

// Public — no auth
counterPosRouter.post('/device/enroll',    authController.enrollDevice);
counterPosRouter.post('/device/stations',  authController.listStationsForEnroll);
counterPosRouter.post('/staff-list',       authController.listStaff);
counterPosRouter.post('/pin-login',        authController.pinLogin);

// Protected — require valid POS access token
counterPosRouter.get('/groups',             authMiddleware, requireFeature('pos.product_search'), requirePermission('pos.product_search.view'), groupController.listGroups);
counterPosRouter.get('/products/search',    authMiddleware, requireFeature('pos.product_search'), requirePermission('pos.product_search.view'), productController.searchByBarcode);
counterPosRouter.get('/products/lookup',    authMiddleware, requireFeature('pos.product_search'), requirePermission('pos.product_search.view'), productController.lookupProducts);
counterPosRouter.get('/customers/search',   authMiddleware, requireFeature('pos.customer_selection'), requirePermission('pos.customer_selection.view'), customerController.searchCustomers);
counterPosRouter.get('/settlement/credit-customers',              authMiddleware, requireFeature('pos.settlement'), requirePermission('pos.settlement.view'), settlementController.listCreditCustomers);
counterPosRouter.get('/settlement/customers/:customerId/bills',   authMiddleware, requireFeature('pos.settlement'), requirePermission('pos.settlement.view'), settlementController.getOutstandingBills);
counterPosRouter.post('/settlement/save',                         authMiddleware, requireFeature('pos.settlement'), requirePermission('pos.settlement.create'), settlementController.saveSettlement);
counterPosRouter.get('/settlement/history',                       authMiddleware, requireFeature('pos.settlement'), requirePermission('pos.settlement.view'), settlementController.listHistory);
counterPosRouter.get('/settlement/receipts/:transactionId',       authMiddleware, requireFeature('pos.settlement'), requirePermission('pos.settlement.view'), settlementController.getReceipt);
counterPosRouter.get('/sales/staff-wise',         authMiddleware, requireFeature('pos.counter_reports'), requirePermission('pos.counter_reports.view'), salesController.staffWiseReport);
counterPosRouter.get('/sales/viewer',             authMiddleware, requireFeature('pos.counter_reports'), requirePermission('pos.counter_reports.view'), salesController.salesViewerList);
counterPosRouter.get('/sales/viewer/:salesId',    authMiddleware, requireFeature('pos.counter_reports'), requirePermission('pos.counter_reports.view'), salesController.salesViewerBill);
counterPosRouter.get('/sales/next-bill-no',      authMiddleware, requireFeature('pos.billing'), requirePermission('pos.billing.create'), salesController.nextBillNo);
counterPosRouter.post('/sales/save',             authMiddleware, requireFeature('pos.billing'), requirePermission('pos.billing.create'), salesController.saveBill);
counterPosRouter.post('/sales/hold',             authMiddleware, requireFeature('pos.order_list'), requirePermission('pos.order_list.create'), salesController.holdBill);
counterPosRouter.get('/sales/held',              authMiddleware, requireFeature('pos.order_list'), requirePermission('pos.order_list.view'), salesController.getHeldBills);
counterPosRouter.get('/sales/held/:salesId',     authMiddleware, requireFeature('pos.order_list'), requirePermission('pos.order_list.view'), salesController.recallBill);
counterPosRouter.post('/sales/held/:salesId/recall', authMiddleware, requireFeature('pos.order_list'), requirePermission('pos.order_list.create'), salesController.recallBill);
counterPosRouter.delete('/sales/held/:salesId',  authMiddleware, requireFeature('pos.order_list'), requirePermission('pos.order_list.delete'), salesController.cancelHold);
counterPosRouter.post('/sales/delivery',                    authMiddleware, requireFeature('pos.delivery'), requirePermission('pos.delivery.create'), salesController.saveDelivery);
counterPosRouter.get('/sales/delivery',                     authMiddleware, requireFeature('pos.delivery'), requirePermission('pos.delivery.view'), salesController.getDeliveryBills);
counterPosRouter.get('/sales/delivery/:salesId',            authMiddleware, requireFeature('pos.delivery'), requirePermission('pos.delivery.view'), salesController.recallDelivery);
counterPosRouter.delete('/sales/delivery/:salesId',         authMiddleware, requireFeature('pos.delivery'), requirePermission('pos.delivery.delete'), salesController.cancelDelivery);
counterPosRouter.post('/sales/delivery/settle-bulk',          authMiddleware, requireFeature('pos.settlement'), requirePermission('pos.settlement.create'), salesController.settleDeliveryBulk);
counterPosRouter.post('/sales/delivery/:salesId/settle',    authMiddleware, requireFeature('pos.settlement'), requirePermission('pos.settlement.create'), salesController.settleDelivery);

// Counter reading — X Report / Z Report
counterPosRouter.get('/counter/summary',            authMiddleware, requireFeature('pos.counter_open_close'), requirePermission('pos.counter_open_close.view'), counterController.getSummary);
counterPosRouter.post('/counter/close',             authMiddleware, requireFeature('pos.counter_open_close'), requirePermission('pos.counter_open_close.create'), counterController.closeCounter);
counterPosRouter.get('/counter/cash-in-out',        authMiddleware, requireFeature('pos.cash_in_out'), requirePermission('pos.cash_in_out.view'), counterController.getCashInOutList);
counterPosRouter.get('/counter/cash-in-out/report', authMiddleware, requireFeature('pos.cash_in_out'), requirePermission('pos.cash_in_out.view'), counterController.getCashInOutReport);
counterPosRouter.post('/counter/cash-in-out',       authMiddleware, requireFeature('pos.cash_in_out'), requirePermission('pos.cash_in_out.create'), counterController.addCashInOut);
counterPosRouter.get('/counter/history',            authMiddleware, requireFeature('pos.counter_open_close'), requirePermission('pos.counter_open_close.view'), counterController.getHistory);
counterPosRouter.get('/counter/history/:closeId',   authMiddleware, requireFeature('pos.counter_open_close'), requirePermission('pos.counter_open_close.view'), counterController.getCloseDetail);
