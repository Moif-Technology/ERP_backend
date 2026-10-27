/**
 * Dashboard Routes — Mounted at /api/dashboard (see src/index.js).
 * Read-only endpoints for salon/laundry business dashboards.
 */

import { Router } from 'express';
import * as dashboardAuthController from './controllers/auth.controller.js';
import * as dashboardController from './controllers/dashboard.controller.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

export const dashboardRouter = Router();

dashboardRouter.post('/auth/login', dashboardAuthController.login);

function requireDashboardAdmin(req, res, next) {
  const roleId = Number(req.authStaff?.role_id);
  const roleName = String(req.authStaff?.role_name || '').toLowerCase();
  const designation = String(req.authStaff?.designation || '').toLowerCase();
  const isAdmin = roleId === 1 || roleName.includes('admin') || designation.includes('admin');

  if (!isAdmin) {
    return res.status(403).json({ message: 'Dashboard access is allowed only for admin users' });
  }

  next();
}

// All dashboard endpoints require authentication
dashboardRouter.use(authMiddleware);
dashboardRouter.use(requireDashboardAdmin);

// ── Counter Close ────────────────────────────────────────
dashboardRouter.get('/counter-close/summary', dashboardController.getCounterCloseSummary);
dashboardRouter.get('/counter-close/pending-bills', dashboardController.getPendingBills);
dashboardRouter.post('/counter-close/shift/:shiftId/close', dashboardController.closeShift);

// ── Sales ─────────────────────────────────────────────────
dashboardRouter.get('/sales', dashboardController.getDailySales);
dashboardRouter.get('/sales/products', dashboardController.getSalesByProduct);
dashboardRouter.get('/sales/payment-methods', dashboardController.getSalesByPaymentMethod);

// ── Staff ─────────────────────────────────────────────────
dashboardRouter.get('/staff/performance', dashboardController.getStaffPerformance);

// ── Inventory ─────────────────────────────────────────────
dashboardRouter.get('/inventory/stock', dashboardController.getInventoryStock);

// ── Customers ─────────────────────────────────────────────
dashboardRouter.get('/customers/ledger', dashboardController.getCustomerLedger);
dashboardRouter.get('/customers/unpaid-bills', dashboardController.getUnpaidBills);
