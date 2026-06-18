import { pool } from '../../config/db.js';
import * as reportService from '../services/report.service.js';

// Wrap a service fn into an Express handler with consistent error handling.
function handler(serviceFn, label) {
  return async (req, res) => {
    try {
      const rows = await serviceFn(pool, req.authStaff, req.query);
      return res.json({ rows });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ message: err.message });
      }
      if (err.code === '42P01') {
        return res.status(503).json({ message: `${label} tables not installed.`, rows: [] });
      }
      console.error(`[report:${label}]`, err);
      return res.status(500).json({ message: `Could not load ${label}` });
    }
  };
}

export const dailySales = handler(reportService.dailySales, 'Daily Sales');
export const customerWiseSales = handler(reportService.customerWiseSales, 'Customer-Wise Sales');
export const productWiseSales = handler(reportService.productWiseSales, 'Product-Wise Sales');
export const salesByAgent = handler(reportService.salesByAgent, 'Sales By Agent');
export const salesReturn = handler(reportService.salesReturn, 'Sales Return');
export const purchaseSummary = handler(reportService.purchaseSummary, 'Purchase Summary');
export const supplierWisePurchase = handler(reportService.supplierWisePurchase, 'Supplier-Wise Purchase');
export const stockSummary = handler(reportService.stockSummary, 'Stock Summary');
export const stockLedger = handler(reportService.stockLedger, 'Stock Ledger');
export const reorder = handler(reportService.reorder, 'Reorder');
export const customerBalance = handler(reportService.customerBalance, 'Customer Balance');
export const supplierBalance = handler(reportService.supplierBalance, 'Supplier Balance');
export const cashBankMovement = handler(reportService.cashBankMovement, 'Cash & Bank Movement');
