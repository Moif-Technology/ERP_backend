import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import pinoHttp from 'pino-http';
import { accountHeadRouter } from './accounts/routes/accountHead.routes.js';
import { vatNatureRouter } from './accounts/routes/vatNature.routes.js';
import { accountsParameterRouter } from './accounts/routes/accountsParameter.routes.js';
import { voucherRouter } from './accounts/routes/voucher.routes.js';
import { adminRouter } from './admin/routes/index.js';
import { areaRouter } from './backoffice/routes/area.routes.js';
import { backofficeDashboardRouter } from './backoffice/routes/backofficeDashboard.routes.js';
import { customerRouter } from './backoffice/routes/customer.routes.js';
import { customerReceiptRouter } from './backoffice/routes/customerReceipt.routes.js';
import { supplierPaymentRouter } from './backoffice/routes/supplierPayment.routes.js';
import { dealsOffersRouter } from './backoffice/routes/dealsOffers.routes.js';
import { deliveryOrderRouter } from './backoffice/routes/deliveryOrder.routes.js';
import { grnRouter } from './backoffice/routes/grn.routes.js';
import { groupRouter } from './backoffice/routes/group.routes.js';
import { locationRouter } from './backoffice/routes/location.routes.js';
import { lpoRouter } from './backoffice/routes/lpo.routes.js';
import { productRouter } from './backoffice/routes/product.routes.js';
import { purchaseEntryRouter } from './backoffice/routes/purchaseEntry.routes.js';
import { purchaseReturnEntryRouter } from './backoffice/routes/purchaseReturnEntry.routes.js';
import { salesReturnEntryRouter } from './backoffice/routes/salesReturnEntry.routes.js';
import { quotationRouter } from './backoffice/routes/quotation.routes.js';
import { reportRouter } from './backoffice/routes/report.routes.js';
import { saleEntryRouter } from './backoffice/routes/saleEntry.routes.js';
import { stockEntryRouter } from './backoffice/routes/stockEntry.routes.js';
import { subGroupRouter } from './backoffice/routes/subGroup.routes.js';
import { subSubGroupRouter } from './backoffice/routes/subSubGroup.routes.js';
import { supplierRouter } from './backoffice/routes/supplier.routes.js';
import { tableRouter } from './backoffice/routes/table.routes.js';
import { assertConfig, config } from './config.js';
import {
  closeAllPools,
  databaseSummaryForLog,
  pool,
  verifyDatabaseConnection,
} from './config/db.js';
import { closeRedis, initRedis } from './config/redis.js';
import { appParameterRouter } from './backoffice/routes/appParameter.routes.js';
import { authRouter } from './core/routes/auth.routes.js';
import { companyRouter } from './core/routes/company.routes.js';
import { exchangeRouter } from './core/routes/exchange.routes.js';
import { planRouter } from './core/routes/plan.routes.js';
import { posDeviceRouter } from './core/routes/posDevice.routes.js';
import { roleRouter } from './core/routes/role.routes.js';
import { ensureTable as ensureRolePageTable } from './core/repositories/roleAccess.repository.js';
import { ensureFeatureCatalog } from './core/repositories/featureCatalogSeed.js';
import { ensureTenantTables } from './core/repositories/ensureTenantTables.js';
import { branchRouter } from './core/routes/branch.routes.js';
import { stationRouter } from './core/routes/station.routes.js';
import { staffRouter } from './core/routes/staff.routes.js';
import { systemParameterRouter } from './core/routes/systemParameter.routes.js';
import { unitRouter } from './core/routes/unit.routes.js';
import { userPreferenceRouter } from './core/routes/userPreference.routes.js';
import { crmDashboardRouter } from './crm/routes/crmDashboard.routes.js';
import { crmFollowupRouter } from './crm/routes/crmFollowup.routes.js';
import { crmInteractionRouter } from './crm/routes/crmInteraction.routes.js';
import { crmLeadRouter } from './crm/routes/crmLead.routes.js';
import { crmLeadSourceRouter } from './crm/routes/crmLeadSource.routes.js';
import { crmLeadStatusRouter } from './crm/routes/crmLeadStatus.routes.js';
import { crmNoteRouter } from './crm/routes/crmNote.routes.js';
import { crmOpportunityRouter } from './crm/routes/crmOpportunity.routes.js';
import { crmOpportunityStageRouter } from './crm/routes/crmOpportunityStage.routes.js';
import { carGroupRouter } from './garage/routes/carGroup.routes.js';
import { carSubGroupRouter } from './garage/routes/carSubGroup.routes.js';
import { colorMasterRouter } from './garage/routes/colorMaster.routes.js';
import { consumableRouter } from './garage/routes/consumable.routes.js';
import { estimationRouter } from './garage/routes/estimation.routes.js';
import { garageDashboardRouter } from './garage/routes/garageDashboard.routes.js';
import { gatePassRouter } from './garage/routes/gatePass.routes.js';
import { invoiceRouter } from './garage/routes/invoice.routes.js';
import { jobCardRouter } from './garage/routes/jobCard.routes.js';
import { jobDescriptionRouter } from './garage/routes/jobDescription.routes.js';
import { lubricantRouter } from './garage/routes/lubricant.routes.js';
import { partRequestRouter } from './garage/routes/partRequest.routes.js';
import { preJobCardRouter } from './garage/routes/preJobCard.routes.js';
import { punchingRouter } from './garage/routes/punching.routes.js';
import { subletJobRouter } from './garage/routes/subletJob.routes.js';
import { subletLpoRouter } from './garage/routes/subletLpo.routes.js';
import { technicianRouter } from './garage/routes/technician.routes.js';
import { vehicleMasterRouter } from './garage/routes/vehicleMaster.routes.js';
import { workshopMonitorRouter } from './garage/routes/workshopMonitor.routes.js';
import { hrRouter } from './hr/routes/hr.routes.js';
import { biometricDeviceRouter } from './hr/routes/biometricDevice.routes.js';
import { buildLimiters } from './middleware/rateLimit.js';
import { counterPosRouter } from './pos/counter-pos/counter-pos.routes.js';
import { posRouter } from './pos/restaurant-pos/pos.routes.js';
import { salonPosRouter } from './pos/salon/salon.routes.js';
import { vanRouter } from './van/van.routes.js';
import { vanMasterRouter } from './backoffice/routes/vanMaster.routes.js';
import { routeMasterRouter } from './backoffice/routes/routeMaster.routes.js';
import { serviceCategoryRouter } from './service/routes/category.routes.js';
import { serviceCatalogueRouter } from './service/routes/service.routes.js';
import { serviceCaseRouter } from './service/routes/case.routes.js';
import { serviceTaskBoardRouter } from './service/routes/caseTaskBoard.routes.js';
import { serviceDocumentsRouter } from './service/routes/caseDocuments.routes.js';
import { servicePaymentsRouter } from './service/routes/casePayments.routes.js';
import { serviceDashboardRouter, serviceExpiryRouter } from './service/routes/serviceDashboard.routes.js';
import { featureAdminRouter } from './core/routes/featureAdmin.routes.js';
import { toolsRouter } from './tools/routes/tools.routes.js';
import { systemActivityLogger } from './middleware/systemActivityLogger.js';
import cookieParser from 'cookie-parser';
import { authMiddleware } from './middleware/authMiddleware.js';
import { requireFeature, requireAnyFeature } from './middleware/entitlementMiddleware.js';

try {
  assertConfig();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

// Connect Redis before building middleware so rate limiters use the shared
// store. Non-fatal: app still boots (memory store + DB-only auth) if Redis off.
await initRedis();
const { apiLimiter, authLimiter } = buildLimiters();

const app = express();

// Make pool available to all route handlers
app.set('pool', pool);

// Honour X-Forwarded-* from LB/Nginx so client IP + rate limiting are correct.
if (config.trustProxy > 0) {
  app.set('trust proxy', config.trustProxy);
}

app.use(helmet());
app.use(compression());

app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true, // required for httpOnly cookie exchange
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());

// Async structured logging (replaces the synchronous res.json wrapper).
// Dev: pretty one-line colored logs. Prod: raw JSON (for log aggregators).
const httpLogger = pinoHttp({
  level: config.logLevel,
  redact: ['req.headers.authorization', 'req.headers.cookie'],
  autoLogging: { ignore: (req) => req.url === '/health' },
  // Quieter per-request line: method, url, status, time — full object only on errors.
  customSuccessMessage: (req, res, time) =>
    `${req.method} ${req.url} ${res.statusCode} ${Math.round(time)}ms`,
  customErrorMessage: (req, res, err) =>
    `${req.method} ${req.url} ${res.statusCode} — ${err?.message || 'error'}`,
  ...(config.nodeEnv !== 'production'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname,req,res,responseTime',
          },
        },
      }
    : {}),
});
app.use(httpLogger);

// Throttle: tight on credentials, general ceiling on the rest of the API.
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/admin/auth/login', authLimiter);
app.use('/api/admin/auth/refresh', authLimiter);
app.use('/api/counter-pos/device/enroll', authLimiter);
app.use('/api/counter-pos/device/stations', authLimiter);
app.use('/api/counter-pos/staff-list', authLimiter);
app.use('/api/counter-pos/pin-login', authLimiter);
// Salon public endpoints. staff-list enumerates staff names for any companyId
// and pin-login brute-forces a 4-6 digit PIN against every staff row, so both
// need the limiter. (/api/pos/* still lacks this — tracked separately.)
app.use('/api/salon-pos/device/enroll', authLimiter);
app.use('/api/salon-pos/device/stations', authLimiter);
app.use('/api/salon-pos/staff-list', authLimiter);
app.use('/api/salon-pos/pin-login', authLimiter);
app.use('/api/salon-pos/login', authLimiter);
app.use('/api', apiLimiter);
app.use('/api', systemActivityLogger);

// Electron auto-updater feed: electron-builder's "generic" provider just does
// plain GETs for latest.yml + the nsis installer, so a static dir is enough —
// no auth, no route logic. Drop new releases into api/updates/ on deploy.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use('/updates', express.static(path.join(__dirname, '../updates')));

// Liveness + DB readiness in one probe so the LB pulls a node with a dead DB.
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/dashboard', backofficeDashboardRouter);
app.use('/api/plans', planRouter);
app.use('/api/pos-devices', posDeviceRouter);
app.use('/api/roles', roleRouter);
app.use('/api/branches', branchRouter);
app.use('/api/stations', stationRouter);
app.use('/api/staff', staffRouter);
app.use('/api/groups', groupRouter);
app.use('/api/areas', areaRouter);
app.use('/api/customers', customerRouter);
app.use('/api/customer-receipts', customerReceiptRouter);
app.use('/api/supplier-payments', supplierPaymentRouter);
app.use('/api/sub-groups', subGroupRouter);
app.use('/api/sub-sub-groups', subSubGroupRouter);
app.use('/api/products', productRouter);
app.use('/api/locations', locationRouter);
app.use('/api/tables', tableRouter);
app.use('/api/quotations', quotationRouter);
app.use('/api/delivery-orders', deliveryOrderRouter);
app.use('/api/sales', saleEntryRouter);
app.use('/api/suppliers', supplierRouter);
app.use('/api/lpos', lpoRouter);
app.use('/api/grns', grnRouter);
app.use('/api/purchases', purchaseEntryRouter);
app.use('/api/purchase-returns', purchaseReturnEntryRouter);
app.use('/api/sales-returns', salesReturnEntryRouter);
app.use('/api/account-heads', accountHeadRouter);
app.use('/api/vat-natures', vatNatureRouter);
app.use('/api/account-parameters', accountsParameterRouter);
app.use('/api/app-parameters', appParameterRouter);
app.use('/api/vouchers', voucherRouter);
app.use('/api/stock-entries', stockEntryRouter);
app.use('/api/reports', reportRouter);
app.use('/api/deals-offers', dealsOffersRouter);
// Device-token routes must come first: hrRouter requires a staff JWT, and the
// office punch receiver has no login.
app.use('/api/hr/biometric', biometricDeviceRouter);
app.use('/api/hr', hrRouter);
app.use('/api/crm/lead-sources', crmLeadSourceRouter);
app.use('/api/crm/lead-statuses', crmLeadStatusRouter);
app.use('/api/crm/opportunity-stages', crmOpportunityStageRouter);
app.use('/api/crm/leads', crmLeadRouter);
app.use('/api/crm/opportunities', crmOpportunityRouter);
app.use('/api/crm/followups', crmFollowupRouter);
app.use('/api/crm/interactions', crmInteractionRouter);
app.use('/api/crm/notes', crmNoteRouter);
app.use('/api/crm/dashboard', crmDashboardRouter);
app.use('/api/pos',         posRouter);
app.use('/api/counter-pos', counterPosRouter);
app.use('/api/salon-pos',   salonPosRouter);
app.use('/api/van',         vanRouter);
app.use('/api/van-master',   vanMasterRouter);
app.use('/api/route-master', routeMasterRouter);
app.use('/api/service/categories', serviceCategoryRouter);
app.use('/api/service/catalogue',  serviceCatalogueRouter);
app.use('/api/service/cases',      serviceCaseRouter);
app.use('/api/service/tasks',      serviceTaskBoardRouter);
app.use('/api/service/documents',  serviceDocumentsRouter);
app.use('/api/service/payments',   servicePaymentsRouter);
app.use('/api/service/dashboard',  serviceDashboardRouter);
app.use('/api/service/expiry',     serviceExpiryRouter);
app.use('/api/admin', adminRouter);
app.use('/api/feature-admin', featureAdminRouter);
// Garage feature gate — applies to every /api/garage/* route.
// authMiddleware runs first (sets req.authStaff), then requireFeature checks
// enabledFeatures. Individual route files run authMiddleware again (no-op).
app.use('/api/garage', authMiddleware, requireFeature('garage'));

app.use('/api/garage/colors',           colorMasterRouter);
app.use('/api/garage/car-groups',       carGroupRouter);
app.use('/api/garage/car-sub-groups',   carSubGroupRouter);
app.use('/api/garage/vehicles',         vehicleMasterRouter);
app.use('/api/garage/pre-job-cards',    preJobCardRouter);
app.use('/api/garage/job-cards',        jobCardRouter);
app.use('/api/garage/estimations',      estimationRouter);
app.use('/api/garage/part-requests',    partRequestRouter);
app.use('/api/garage/technicians',      technicianRouter);
app.use('/api/garage/job-descriptions', jobDescriptionRouter);
app.use('/api/garage/punchings',        punchingRouter);
app.use('/api/garage/sublet-jobs',      subletJobRouter);
app.use('/api/garage/sublet-lpos',      subletLpoRouter);
app.use('/api/garage/consumables',      consumableRouter);
app.use('/api/garage/lubricants',       lubricantRouter);
app.use('/api/garage/gate-passes',      gatePassRouter);
app.use('/api/garage/invoices',         invoiceRouter);
app.use('/api/garage/workshop-monitor', workshopMonitorRouter);
app.use('/api/garage/dashboard',        garageDashboardRouter);
app.use('/api/exchange', exchangeRouter);
app.use('/api/company', companyRouter);
app.use('/api/parameters', systemParameterRouter);
app.use('/api/units', unitRouter);
app.use('/api/user-preferences', userPreferenceRouter);
app.use('/api/tools', toolsRouter);

// Map common Postgres error codes to HTTP status + a safe client message.
// Controllers that simply `next(err)` get consistent responses for free.
function mapPgError(err) {
  switch (err.code) {
    case '23505': return { status: 409, message: 'Duplicate value violates a unique constraint' };
    case '23503': return { status: 409, message: 'Operation violates a related-record constraint' };
    case '23502': return { status: 400, message: 'A required field is missing' };
    case '22P02': return { status: 400, message: 'Invalid input value' };
    case '42P01': return { status: 503, message: 'A required table is not installed. Run database migrations.' };
    case '42703': return { status: 503, message: 'A required column is missing. Run database migrations.' };
    default: return null;
  }
}

app.use((err, req, res, _next) => {
  const pg = !err.status ? mapPgError(err) : null;
  const status = Number(err.status || err.statusCode) || pg?.status || 500;
  const log = req.log || console;
  log.error(
    { code: err.code, detail: err.detail, stack: status >= 500 ? err.stack : undefined },
    `[API ${status}] ${req.method} ${req.originalUrl} — ${err.message}`
  );

  // Never leak internal/DB error text to clients on 500s in production.
  let clientMessage;
  if (status >= 500) {
    clientMessage = config.nodeEnv === 'production' ? 'Server error' : (err.message || 'Server error');
  } else {
    clientMessage = pg?.message || err.message || 'Request failed';
  }

  res.status(status >= 400 && status < 600 ? status : 500).json({ message: clientMessage });
});

function printBanner() {
  const line = '-------------------------------------------------';
  console.log('');
  console.log(line);
  console.log('  Moifone ERP API (unified)');
  console.log(line);
  console.log(`  [DB] CONNECTED    : ${databaseSummaryForLog()}`);
  console.log(line);
  console.log(`  [SERVER] Running  : http://localhost:${config.port}`);
  console.log(line);
  console.log('  [ROUTES] GET     /health');
  console.log('  [ROUTES] GET     /api/plans');
  console.log('  [ROUTES] POST    /api/auth/register');
  console.log('  [ROUTES] POST    /api/auth/login');
  console.log('  [ROUTES] POST    /api/auth/logout');
  console.log('  [ROUTES] GET     /api/auth/me');
  console.log('  [ROUTES] POST    /api/auth/refresh');
  console.log('  [ROUTES] POST    /api/auth/forgot-password');
  console.log('  [ROUTES] POST    /api/auth/reset-password');
  console.log('  [ROUTES] GET     /api/groups');
  console.log('  [ROUTES] POST    /api/groups');
  console.log('  [ROUTES] GET     /api/areas');
  console.log('  [ROUTES] POST    /api/areas');
  console.log('  [ROUTES] GET     /api/customers');
  console.log('  [ROUTES] POST    /api/customers');
  console.log('  [ROUTES] GET     /api/sub-groups');
  console.log('  [ROUTES] POST    /api/sub-groups');
  console.log('  [ROUTES] GET     /api/products');
  console.log('  [ROUTES] POST    /api/products');
  console.log('  [ROUTES] GET     /api/tables');
  console.log('  [ROUTES] POST    /api/tables');
  console.log('  [ROUTES] POST    /api/pos/kot/save');
  console.log('  [ROUTES] GET     /api/pos/kot/:kotMasterId');
  console.log('  [ROUTES] POST    /api/pos/sales/settle');
  console.log('  [ROUTES] GET/POST /api/quotations');
  console.log('  [ROUTES] POST    /api/sales');
  console.log('  [ROUTES] GET/POST /api/suppliers');
  console.log('  [ROUTES] GET/POST /api/lpos');
  console.log('  [ROUTES] PUT     /api/lpos/:lpoMasterId');
  console.log('  [ROUTES] GET     /api/grns');
  console.log('  [ROUTES] POST    /api/purchases');
  console.log('  [ROUTES] GET     /api/account-heads');
  console.log('  [ROUTES] GET/PATCH /api/account-parameters/branch-defaults');
  console.log('  [ROUTES] CRUD   /api/account-heads (tree, create, update, delete)');
  console.log('  [ROUTES] CRUD   /api/vouchers (list, create, post, unpost, delete)');
  console.log('  [ROUTES] GET    /api/vouchers/types');
  console.log('  [ROUTES] GET    /api/vouchers/ledger/:accountId');
  console.log('  [ROUTES] GET    /api/vouchers/trial-balance');
  console.log(line);
  console.log('');
}

async function start() {
  try {
    await verifyDatabaseConnection();
    await ensureTenantTables();
    await ensureRolePageTable();
    await ensureFeatureCatalog();
  } catch (err) {
    console.error('');
    console.error('  [DB] FAILED — could not connect');
    console.error('  ', err.message);
    console.error('  Fix DATABASE_URL in api/.env and ensure PostgreSQL is running.');
    console.error('');
    await pool.end().catch(() => {});
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    printBanner();
  });

  // Request/connection timeouts so a slow client/query can't hold a socket open.
  server.requestTimeout = 20_000;
  server.headersTimeout = 22_000;
  server.keepAliveTimeout = 65_000; // keep > LB idle timeout

  // Graceful shutdown: stop accepting, drain in-flight, close pools + Redis.
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received — draining connections`);
    const force = setTimeout(() => {
      console.error('[shutdown] drain timed out — forcing exit');
      process.exit(1);
    }, 10_000);
    force.unref();
    server.close(async () => {
      await closeAllPools();
      await closeRedis();
      clearTimeout(force);
      console.log('[shutdown] clean exit');
      process.exit(0);
    });
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
