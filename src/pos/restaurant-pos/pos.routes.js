/**
 * Restaurant / Quick-service POS API — mounted at /api/pos (see src/index.js).
 *
 * Serves two clients:
 *   - RestaurantPOS (Flutter): username/password login, KOT, settle.
 *   - Deyno Quick (React/Vite): device-enrolled till — enroll, PIN login, KOT,
 *     settle, counter X/Z reading, cash in/out, sales viewer, credit receipts.
 *
 * DESIGN NOTE — why counter-pos controllers appear here.
 * Counter reading, credit settlement and the sales viewer are not
 * counter-specific: they read and write the same ops.sales_master /
 * ops.sales_child / ops.sales_payment_split rows this product already writes,
 * and every one of them is driven purely by `req.authStaff` (company, branch,
 * station). Salon-POS reuses them for exactly this reason. Forking them would
 * mean maintaining a third copy of ~2,500 lines and fixing every bug three
 * times. A fix applied once in counter-pos reaches all three products.
 *
 * TWO AUTH PATHS with different token scopes — see deviceAuth.controller.js.
 * Do not merge them onto one endpoint: `/pin-login` issues an ERP-scoped token,
 * `/device/pin-login` issues a POS-scoped one, and authMiddleware registers a
 * different session type for each.
 */
import { Router } from 'express';

import * as posController from './controllers/pos.controller.js';
import * as deviceAuthController from './controllers/deviceAuth.controller.js';
import { kotRouter } from './routes/kot.routes.js';
import { salesRouter } from './routes/sales.routes.js';

// Reused verbatim from counter-pos — generic over req.authStaff, same tables.
import * as counterSalesController from '../counter-pos/controllers/sales.controller.js';
import * as settlementController from '../counter-pos/controllers/settlement.controller.js';
import * as counterController from '../counter-pos/controllers/counter.controller.js';
// Aggregate sales reports (salesman / item / group). Salon owns these but the
// queries are plain company + date-range aggregates over ops.sales_master —
// nothing salon-specific — and restaurant settle writes every column they read.
import * as salonSalesController from '../salon/controllers/sales.controller.js';
// Reused from salon — verifies username/password against staff_master in the
// caller's own company and checks the role is supervisor-class. No salon logic.
import * as supervisorController from '../salon/controllers/supervisor.controller.js';

import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature, requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const posRouter = Router();

// ── Public (no auth). Rate-limited in src/index.js. ────────────────────────

// A) Legacy path — Flutter RestaurantPOS. ERP-scoped token.
posRouter.post('/login',      posController.login);
posRouter.post('/pin-login',  posController.pinLogin);
posRouter.post('/staff-list', posController.staffList);

// B) Device-enrolled till — Deyno Quick. POS-scoped token.
//   1. /device/stations   admin creds -> list RESTAURANT_POS tills
//   2. /device/enroll     admin creds + stationId -> pair this deviceToken
//   3. /device/staff-list deviceToken -> staff picker (not public by companyId)
//   4. /device/pin-login  deviceToken + staffId + pin -> POS-scoped token
posRouter.post('/device/stations',   deviceAuthController.listStationsForEnroll);
posRouter.post('/device/enroll',     deviceAuthController.enrollDevice);
posRouter.post('/device/staff-list', deviceAuthController.staffListForDevice);
posRouter.post('/device/pin-login',  deviceAuthController.pinLogin);

// ── Everything below requires a valid token. ──────────────────────────────
posRouter.use(authMiddleware);
posRouter.use(requireFeature('pos'));

// KOT (kitchen order tickets) and settle — the core order lifecycle.
posRouter.use('/kot', kotRouter);
posRouter.use('/sales', salesRouter);

// Sales viewer — posted bills list + bill detail for reprint.
// Accepts pos.counter_reports OR base pos, matching salon: a plan that does not
// itemise counter_reports still gets its own bill list.
posRouter.get(
  '/sales/viewer',
  requireAnyFeature(['pos.counter_reports', 'pos']),
  counterSalesController.salesViewerList,
);
posRouter.get(
  '/sales/viewer/:salesId',
  requireAnyFeature(['pos.counter_reports', 'pos']),
  counterSalesController.salesViewerBill,
);
posRouter.get(
  '/sales/staff-wise',
  requireAnyFeature(['pos.counter_reports', 'pos']),
  counterSalesController.staffWiseReport,
);
// NOTE: /sales/next-bill-no is served by salesRouter above, using restaurant's
// own per-station numbering. Counter-pos's nextBillNo is company-wide and would
// preview a number settle never assigns on a multi-till site.

// Aggregate sales reports. Same three kinds the salon till exposes.
posRouter.get(
  '/sales/reports/salesman-wise',
  requireAnyFeature(['pos.counter_reports', 'pos']),
  salonSalesController.salesmanWiseReport,
);
posRouter.get(
  '/sales/reports/item-wise',
  requireAnyFeature(['pos.counter_reports', 'pos']),
  salonSalesController.itemWiseReport,
);
posRouter.get(
  '/sales/reports/group-wise',
  requireAnyFeature(['pos.counter_reports', 'pos']),
  salonSalesController.groupWiseReport,
);

// Counter reading — X Report / Z Report, and cash in/out.
posRouter.get('/counter/summary',            requireFeature('pos.counter_open_close'), counterController.getSummary);
posRouter.post('/counter/close',             requireFeature('pos.counter_open_close'), counterController.closeCounter);
posRouter.get('/counter/history',            requireFeature('pos.counter_open_close'), counterController.getHistory);
posRouter.get('/counter/history/:closeId',   requireFeature('pos.counter_open_close'), counterController.getCloseDetail);
posRouter.get('/counter/cash-in-out',        requireFeature('pos.cash_in_out'),        counterController.getCashInOutList);
posRouter.get('/counter/cash-in-out/report', requireFeature('pos.cash_in_out'),        counterController.getCashInOutReport);
posRouter.post('/counter/cash-in-out',       requireFeature('pos.cash_in_out'),        counterController.addCashInOut);

// Credit receipts against outstanding sales (customer O/S -> cash_transaction).
posRouter.get('/settlement/credit-customers',            requireFeature('pos.settlement'), settlementController.listCreditCustomers);
posRouter.get('/settlement/customers/:customerId/bills', requireFeature('pos.settlement'), settlementController.getOutstandingBills);
posRouter.post('/settlement/save',                       requireFeature('pos.settlement'), settlementController.saveSettlement);
posRouter.get('/settlement/history',                     requireFeature('pos.settlement'), settlementController.listHistory);
posRouter.get('/settlement/receipts/:transactionId',     requireFeature('pos.settlement'), settlementController.getReceipt);

// Supervisor approval for protected actions (line delete, qty change, discount).
posRouter.post('/supervisor/verify', supervisorController.verify);

// Parameters & privileges.
posRouter.get('/parameters',                 posController.getParameters);
posRouter.get('/parameter-definitions',      posController.getParameterDefinitions);
posRouter.put('/parameters',                 posController.putParameters);
posRouter.put('/parameters/company-details', posController.putCompanyDetails);
posRouter.get('/privileges',                 posController.getPrivileges);
