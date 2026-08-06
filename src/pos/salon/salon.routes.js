/**
 * SalonPOS API — mounted at /api/salon-pos (see src/index.js).
 *
 * DESIGN NOTE — why this file is short.
 *
 * Auth, POS parameters and privileges are IDENTICAL to restaurant. Rather than
 * copying ~1,950 lines into a third POS fork, this router reuses the restaurant
 * controllers directly and adds only what is genuinely salon-specific: jobs with
 * typed lines, and stylists.
 *
 * The alternative (a full fork, as counter-pos did) would have duplicated four
 * known defects — the walk-in customer FK trap, the waiter_id NOT NULL crash, the
 * append double-bill when the client omits a child id, and unscoped ticket reads.
 * A fix applied once here reaches both products.
 *
 * `requireFeature('pos')` is used, NOT `requireFeature('salon')`. There is no
 * 'salon' row in core.feature_master, and software_type_feature.feature_code is
 * an FK to it — a 'salon' code would 403 every request forever. Salon IS the pos
 * pack; migration 104 grants the pos pack to software type 8.
 */
import { Router } from 'express';

// Reused verbatim from restaurant — same behaviour, no salon divergence.
import * as posController from '../restaurant-pos/controllers/pos.controller.js';

// Salon-specific.
import * as authController from './controllers/auth.controller.js';
import * as jobController from './controllers/job.controller.js';
import * as stylistController from './controllers/stylist.controller.js';
import * as salesController from './controllers/sales.controller.js';
import * as appointmentController from './controllers/appointment.controller.js';
import * as supervisorController from './controllers/supervisor.controller.js';
// Credit receipts — same service as counter-pos (customer O/S → cash_transaction).
import * as settlementController from '../counter-pos/controllers/settlement.controller.js';
import * as counterController from '../counter-pos/controllers/counter.controller.js';

import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature, requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const salonPosRouter = Router();

// ── Public (no auth). Rate-limited in src/index.js. ────────────────────────
// NOT reused from restaurant: those hardcode posType 'RESTAURANT-POS' (which
// rejects SALON-POS roles), and the username/password path never registers a
// session, so the next request 401s. See controllers/auth.controller.js.
//
// Device enrollment flow (mirrors counter-pos):
//   1. /device/stations  admin creds -> list SALON_POS tills
//   2. /device/enroll    admin creds + stationId -> pair this deviceToken
//   3. /staff-list       deviceToken -> staff picker (NOT public by companyId)
//   4. /pin-login        deviceToken + staffId + pin -> POS-scoped token
salonPosRouter.post('/device/stations', authController.listStationsForEnroll);
salonPosRouter.post('/device/enroll',   authController.enrollDevice);
salonPosRouter.post('/staff-list',      authController.staffList);
salonPosRouter.post('/pin-login',       authController.pinLogin);

// Username + password (admin convenience; ERP-scoped token).
salonPosRouter.post('/login',           authController.login);

// ── Everything below requires a valid POS token. ───────────────────────────
salonPosRouter.use(authMiddleware);
salonPosRouter.use(requireFeature('pos'));

// Jobs — the salon analogue of restaurant KOTs.
salonPosRouter.post('/job/save',                         requireFeature('pos.salon.jobs'), jobController.saveJob);
salonPosRouter.get('/job/list',                          requireFeature('pos.salon.jobs'), jobController.listJobs);
salonPosRouter.get('/job/:jobId',                        requireFeature('pos.salon.jobs'), jobController.getJob);
salonPosRouter.patch('/job/:jobId/line/:lineId/status',  requireFeature('pos.salon.service_status'), jobController.setServiceStatus);
salonPosRouter.patch('/job/:jobId/line/:lineId/stylist', requireFeature('pos.salon.stylist_reassign'), jobController.reassignStylist);

// Settlement. Gated on pos.settlement like restaurant's, so a plan that sells
// the job board without billing still cannot take money.
salonPosRouter.post('/sales/settle', requireFeature('pos.settlement'), salesController.settle);

// Sales Viewer — posted bills list + bill-with-details (same idea as Counter-POS).
// Accept pos.counter_reports OR base pos (menu treats absent counter_reports as allowed).
salonPosRouter.get(
  '/sales/viewer',
  requireAnyFeature(['pos.counter_reports', 'pos']),
  salesController.salesViewerList,
);
salonPosRouter.get(
  '/sales/viewer/:salesId',
  requireAnyFeature(['pos.counter_reports', 'pos']),
  salesController.salesViewerBill,
);

// Aggregate sales reports (salesman / item / group).
salonPosRouter.get(
  '/sales/reports/salesman-wise',
  requireAnyFeature(['pos.counter_reports', 'pos']),
  salesController.salesmanWiseReport,
);
salonPosRouter.get(
  '/sales/reports/item-wise',
  requireAnyFeature(['pos.counter_reports', 'pos']),
  salesController.itemWiseReport,
);
salonPosRouter.get(
  '/sales/reports/group-wise',
  requireAnyFeature(['pos.counter_reports', 'pos']),
  salesController.groupWiseReport,
);

// Credit receipts against sales O/S (same as counter-pos /settlement/*).salonPosRouter.get('/settlement/credit-customers', settlementController.listCreditCustomers);
salonPosRouter.get('/settlement/customers/:customerId/bills', settlementController.getOutstandingBills);
salonPosRouter.post('/settlement/save', settlementController.saveSettlement);
salonPosRouter.get('/settlement/history', settlementController.listHistory);
salonPosRouter.get('/settlement/receipts/:transactionId', settlementController.getReceipt);

// Counter reading — X Report / Z Report (reuse counter-pos).
salonPosRouter.get('/counter/summary', requireFeature('pos.counter_open_close'), counterController.getSummary);
salonPosRouter.post('/counter/close', requireFeature('pos.counter_open_close'), counterController.closeCounter);
salonPosRouter.get('/counter/cash-in-out', requireFeature('pos.cash_in_out'), counterController.getCashInOutList);
salonPosRouter.get('/counter/cash-in-out/report', requireFeature('pos.cash_in_out'), counterController.getCashInOutReport);
salonPosRouter.post('/counter/cash-in-out', requireFeature('pos.cash_in_out'), counterController.addCashInOut);
salonPosRouter.get('/counter/history', requireFeature('pos.counter_open_close'), counterController.getHistory);
salonPosRouter.get('/counter/history/:closeId', requireFeature('pos.counter_open_close'), counterController.getCloseDetail);

// Supervisor approval (delete/qty on saved job lines, etc.)
salonPosRouter.post('/supervisor/verify', supervisorController.verify);

// Stylists — no restaurant equivalent.
salonPosRouter.get('/stylists',                  requireFeature('pos.salon.stylists'), stylistController.listStylists);
salonPosRouter.get('/stylists/:stylistId/load',  requireFeature('pos.salon.stylists'), stylistController.getStylistLoad);

// Appointments — booking system for salon (phase 1).
salonPosRouter.post('/appointments',                        requireFeature('pos.salon.appointments'), appointmentController.createAppointment);
salonPosRouter.get('/appointments',                         requireFeature('pos.salon.appointments'), appointmentController.listAppointments);
salonPosRouter.get('/appointments/:appointmentId',          requireFeature('pos.salon.appointments'), appointmentController.getAppointmentDetail);
salonPosRouter.put('/appointments/:appointmentId',          requireFeature('pos.salon.appointments'), appointmentController.updateAppointment);
salonPosRouter.delete('/appointments/:appointmentId',       requireFeature('pos.salon.appointments'), appointmentController.cancelAppointment);
salonPosRouter.post('/appointments/:appointmentId/confirm', requireFeature('pos.salon.appointments'), appointmentController.confirmAppointment);
salonPosRouter.post('/appointments/:appointmentId/check-in', requireFeature('pos.salon.appointments'), appointmentController.checkInAppointment);
salonPosRouter.get('/stylists/:stylistId/availability',     requireFeature('pos.salon.appointments'), appointmentController.getStylistAvailability);
salonPosRouter.get('/appointments/stats/daily-load',        requireFeature('pos.salon.appointments'), appointmentController.getDailyLoad);

// Parameters & privileges — reused from restaurant.
salonPosRouter.get('/parameters',                    posController.getParameters);
salonPosRouter.get('/parameter-definitions',         posController.getParameterDefinitions);
salonPosRouter.put('/parameters',                    posController.putParameters);
salonPosRouter.put('/parameters/company-details',    posController.putCompanyDetails);
salonPosRouter.get('/privileges',                    posController.getPrivileges);
