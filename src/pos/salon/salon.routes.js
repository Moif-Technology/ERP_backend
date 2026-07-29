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

import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

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
salonPosRouter.post('/job/save',                       jobController.saveJob);
salonPosRouter.get('/job/list',                        jobController.listJobs);
salonPosRouter.get('/job/:jobId',                      jobController.getJob);
salonPosRouter.patch('/job/:jobId/line/:lineId/status',  jobController.setServiceStatus);
salonPosRouter.patch('/job/:jobId/line/:lineId/stylist', jobController.reassignStylist);

// Settlement. Gated on pos.settlement like restaurant's, so a plan that sells
// the job board without billing still cannot take money.
salonPosRouter.post('/sales/settle', requireFeature('pos.settlement'), salesController.settle);

// Stylists — no restaurant equivalent.
salonPosRouter.get('/stylists',                  stylistController.listStylists);
salonPosRouter.get('/stylists/:stylistId/load',  stylistController.getStylistLoad);

// Parameters & privileges — reused from restaurant.
salonPosRouter.get('/parameters',                    posController.getParameters);
salonPosRouter.get('/parameter-definitions',         posController.getParameterDefinitions);
salonPosRouter.put('/parameters',                    posController.putParameters);
salonPosRouter.put('/parameters/company-details',    posController.putCompanyDetails);
salonPosRouter.get('/privileges',                    posController.getPrivileges);
