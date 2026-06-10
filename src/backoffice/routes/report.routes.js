import { Router } from 'express';
import * as reportController from '../controllers/report.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const reportRouter = Router();

reportRouter.use(authMiddleware);

// Sales
reportRouter.get('/daily-sales', reportController.dailySales);
reportRouter.get('/customer-wise-sales', reportController.customerWiseSales);
reportRouter.get('/product-wise-sales', reportController.productWiseSales);
reportRouter.get('/sales-by-agent', reportController.salesByAgent);
reportRouter.get('/sales-return', reportController.salesReturn);

// Purchase
reportRouter.get('/purchase-summary', reportController.purchaseSummary);
reportRouter.get('/supplier-wise-purchase', reportController.supplierWisePurchase);

// Stock
reportRouter.get('/stock-summary', reportController.stockSummary);
reportRouter.get('/stock-ledger', reportController.stockLedger);
reportRouter.get('/reorder', reportController.reorder);

// Accounts
reportRouter.get('/customer-balance', reportController.customerBalance);
reportRouter.get('/supplier-balance', reportController.supplierBalance);
reportRouter.get('/cash-bank-movement', reportController.cashBankMovement);
