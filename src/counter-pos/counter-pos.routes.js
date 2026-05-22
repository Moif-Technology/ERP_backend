import { Router } from 'express';
import * as authController     from './controllers/auth.controller.js';
import * as productController  from './controllers/product.controller.js';
import * as customerController from './controllers/customer.controller.js';
import * as salesController    from './controllers/sales.controller.js';
import * as groupController    from './controllers/group.controller.js';
import * as counterController  from './controllers/counter.controller.js';
import { authMiddleware }      from '../middleware/authMiddleware.js';

export const counterPosRouter = Router();

// Public — no auth
counterPosRouter.post('/device/enroll', authController.enrollDevice);
counterPosRouter.post('/pin-login',     authController.pinLogin);

// Protected — require valid POS access token
counterPosRouter.get('/groups',             authMiddleware, groupController.listGroups);
counterPosRouter.get('/products/search',    authMiddleware, productController.searchByBarcode);
counterPosRouter.get('/products/lookup',    authMiddleware, productController.lookupProducts);
counterPosRouter.get('/customers/search',   authMiddleware, customerController.searchCustomers);
counterPosRouter.get('/sales/staff-wise',         authMiddleware, salesController.staffWiseReport);
counterPosRouter.get('/sales/next-bill-no',      authMiddleware, salesController.nextBillNo);
counterPosRouter.post('/sales/save',             authMiddleware, salesController.saveBill);
counterPosRouter.post('/sales/hold',             authMiddleware, salesController.holdBill);
counterPosRouter.get('/sales/held',              authMiddleware, salesController.getHeldBills);
counterPosRouter.get('/sales/held/:salesId',     authMiddleware, salesController.recallBill);
counterPosRouter.delete('/sales/held/:salesId',  authMiddleware, salesController.cancelHold);

// Counter reading — X Report / Z Report
counterPosRouter.get('/counter/summary',            authMiddleware, counterController.getSummary);
counterPosRouter.post('/counter/close',             authMiddleware, counterController.closeCounter);
counterPosRouter.get('/counter/cash-in-out',        authMiddleware, counterController.getCashInOutList);
counterPosRouter.post('/counter/cash-in-out',       authMiddleware, counterController.addCashInOut);
counterPosRouter.get('/counter/history',            authMiddleware, counterController.getHistory);
counterPosRouter.get('/counter/history/:closeId',   authMiddleware, counterController.getCloseDetail);
