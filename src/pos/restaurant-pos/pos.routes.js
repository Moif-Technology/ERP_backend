/**
 * Restaurant / Quick-service POS API — mounted at /api/pos (see src/index.js).
 *
 * Serves two clients:
 *   - RestaurantPOS (Flutter): username/password login, KOT, settle.
 *   - Deyno Quick (React/Vite): device-enrolled till — enroll, PIN login, KOT,
 *     settle, counter X/Z reading, cash in/out, sales viewer, credit receipts.
 *
 * Restaurant routes own sales viewing and counter close. Shared counter-pos
 * controllers still provide cash movements, history, staff reports and credit
 * receipts. Each URL is mounted once so neither client's handler is shadowed.
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
import { printerRouter } from './routes/printer.routes.js';
import { salesRouter } from './routes/sales.routes.js';
import { counterRouter } from './routes/counter.routes.js';
import { inventoryRouter } from './routes/inventory.routes.js';
import { stockEntryRouter } from './routes/stockEntry.routes.js';
import { recipeRouter } from './routes/recipe.routes.js';

// Reused verbatim from counter-pos — generic over req.authStaff, same tables.
import * as counterSalesController from '../counter-pos/controllers/sales.controller.js';
import * as settlementController from '../counter-pos/controllers/settlement.controller.js';
import * as counterController from '../counter-pos/controllers/counter.controller.js';
// Aggregate sales reports (salesman / item / group). Salon owns these but the
// queries are plain company + date-range aggregates over ops.sales_master —
// nothing salon-specific — and restaurant settle writes every column they read.
import * as salonSalesController from '../salon/controllers/sales.controller.js';
// Quick supervisor/PIN approval and restaurant chief-cashier approval.
import * as supervisorController from './controllers/supervisor.controller.js';

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
posRouter.use('/printers', printerRouter);
posRouter.use('/sales', salesRouter);
posRouter.use('/counter', counterRouter);
posRouter.use('/inventory', inventoryRouter);
posRouter.use('/stock-entry', stockEntryRouter);
posRouter.use('/recipes', recipeRouter);

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
