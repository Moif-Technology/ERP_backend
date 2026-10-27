import { Router } from 'express';
import * as reportController from '../controllers/report.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const reportRouter = Router();

reportRouter.use(authMiddleware);
reportRouter.use(requireAnyFeature(['backoffice.reports', 'hr.reports', 'crm.reports', 'garage.reports']));

// Filter dropdowns (branches, stations, groups, sub-groups, suppliers)
reportRouter.get('/lookups', reportController.lookups);

// Sales
reportRouter.get('/sales-summary', reportController.salesSummary);
reportRouter.get('/sales-by-pos', reportController.salesByPos);
reportRouter.get('/sales-analysis', reportController.salesAnalysis);
reportRouter.get('/daily-sales', reportController.dailySales);
reportRouter.get('/customer-wise-sales', reportController.customerWiseSales);
reportRouter.get('/product-wise-sales', reportController.productWiseSales);
reportRouter.get('/sales-by-agent', reportController.salesByAgent);
reportRouter.get('/sales-return', reportController.salesReturn);

// Purchase
reportRouter.get('/purchase-summary', reportController.purchaseSummary);
reportRouter.get('/supplier-wise-purchase', reportController.supplierWisePurchase);
reportRouter.get('/purchase-by-product', reportController.purchaseByProduct);
reportRouter.get('/purchase-return', reportController.purchaseReturn);
reportRouter.get('/outstanding-lpo', reportController.outstandingLPO);

// Stock
reportRouter.get('/stock-summary', reportController.stockSummary);
reportRouter.get('/stock-ledger', reportController.stockLedger);
reportRouter.get('/reorder', reportController.reorder);
reportRouter.get('/inventory-reconciliation', reportController.inventoryReconciliation);
reportRouter.get('/live-store-status', reportController.liveStoreStatus);

// Accounts
reportRouter.get('/customer-balance', reportController.customerBalance);
reportRouter.get('/supplier-balance', reportController.supplierBalance);
reportRouter.get('/cash-bank-movement', reportController.cashBankMovement);
reportRouter.get('/accounts-reconciliation', reportController.accountsReconciliation);

// HR
reportRouter.get('/attendance-report', reportController.attendanceReport);
reportRouter.get('/leave-report', reportController.leaveReport);

// Report designs (per company × branch × report_key)
reportRouter.get('/designs',    reportController.getReportDesign);
reportRouter.put('/designs',    reportController.saveReportDesign);
reportRouter.delete('/designs', reportController.deleteReportDesign);
