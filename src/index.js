import express from 'express';
import cors from 'cors';
import { config, assertConfig } from './config.js';
import {
  pool,
  verifyDatabaseConnection,
  databaseSummaryForLog,
} from './config/db.js';
import { authRouter } from './routes/auth.routes.js';
import { planRouter } from './routes/plan.routes.js';
import { roleRouter } from './routes/role.routes.js';
import { staffRouter } from './routes/staff.routes.js';
import { groupRouter } from './routes/group.routes.js';
import { areaRouter } from './routes/area.routes.js';
import { customerRouter } from './routes/customer.routes.js';
import { subGroupRouter } from './routes/subGroup.routes.js';
import { productRouter } from './routes/product.routes.js';
import { tableRouter } from './routes/table.routes.js';
import { quotationRouter } from './routes/quotation.routes.js';
import { deliveryOrderRouter } from './routes/deliveryOrder.routes.js';
import { saleEntryRouter } from './routes/saleEntry.routes.js';
import { supplierRouter } from './routes/supplier.routes.js';
import { purchaseEntryRouter } from './routes/purchaseEntry.routes.js';
import { lpoRouter } from './routes/lpo.routes.js';
import { grnRouter } from './routes/grn.routes.js';
import { accountHeadRouter } from './routes/accountHead.routes.js';
import { accountsParameterRouter } from './routes/accountsParameter.routes.js';
import { appParameterRouter } from './routes/appParameter.routes.js';
import { voucherRouter } from './routes/voucher.routes.js';
import { stockEntryRouter } from './routes/stockEntry.routes.js';
import { dealsOffersRouter } from './routes/dealsOffers.routes.js';
import { posRouter } from './pos/pos.routes.js';
import { hrRouter } from './routes/hr.routes.js';
import { crmLeadSourceRouter } from './routes/crmLeadSource.routes.js';
import { crmLeadStatusRouter } from './routes/crmLeadStatus.routes.js';
import { crmOpportunityStageRouter } from './routes/crmOpportunityStage.routes.js';
import { crmLeadRouter } from './routes/crmLead.routes.js';
import { crmOpportunityRouter } from './routes/crmOpportunity.routes.js';
import { crmFollowupRouter } from './routes/crmFollowup.routes.js';
import { crmInteractionRouter } from './routes/crmInteraction.routes.js';
import { crmNoteRouter } from './routes/crmNote.routes.js';
import { crmDashboardRouter } from './routes/crmDashboard.routes.js';
import { adminRouter } from './admin/routes/index.js';
import { colorMasterRouter }      from './routes/garage/colorMaster.routes.js';
import { carGroupRouter }          from './routes/garage/carGroup.routes.js';
import { carSubGroupRouter }       from './routes/garage/carSubGroup.routes.js';
import { vehicleMasterRouter }     from './routes/garage/vehicleMaster.routes.js';
import { preJobCardRouter }        from './routes/garage/preJobCard.routes.js';
import { jobCardRouter }           from './routes/garage/jobCard.routes.js';
import { estimationRouter }        from './routes/garage/estimation.routes.js';
import { partRequestRouter }       from './routes/garage/partRequest.routes.js';
import { technicianRouter }        from './routes/garage/technician.routes.js';
import { jobDescriptionRouter }    from './routes/garage/jobDescription.routes.js';
import { punchingRouter }          from './routes/garage/punching.routes.js';
import { subletJobRouter }         from './routes/garage/subletJob.routes.js';
import { subletLpoRouter }         from './routes/garage/subletLpo.routes.js';
import { consumableRouter }        from './routes/garage/consumable.routes.js';
import { lubricantRouter }         from './routes/garage/lubricant.routes.js';
import { gatePassRouter }          from './routes/garage/gatePass.routes.js';
import { invoiceRouter }           from './routes/garage/invoice.routes.js';
import { garageDashboardRouter }   from './routes/garage/garageDashboard.routes.js';
import { workshopMonitorRouter }   from './routes/garage/workshopMonitor.routes.js';
import { exchangeRouter }     from './routes/exchange.routes.js';
import { counterPosRouter }   from './counter-pos/counter-pos.routes.js';

try {
  assertConfig();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const app = express();

app.use(
  cors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS','DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json({ limit: '256kb' }));

/** Log any JSON response with status >= 400 (validation, conflicts, DB errors mapped in controllers). */
app.use((req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = function logJsonOnError(body) {
    if (res.statusCode >= 400) {
      console.warn(
        `[API ${res.statusCode}] ${req.method} ${req.originalUrl}`,
        typeof body === 'object' && body !== null ? body : String(body)
      );
    }
    return origJson(body);
  };
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);
app.use('/api/plans', planRouter);
app.use('/api/roles', roleRouter);
app.use('/api/staff', staffRouter);
app.use('/api/groups', groupRouter);
app.use('/api/areas', areaRouter);
app.use('/api/customers', customerRouter);
app.use('/api/sub-groups', subGroupRouter);
app.use('/api/products', productRouter);
app.use('/api/tables', tableRouter);
app.use('/api/quotations', quotationRouter);
app.use('/api/delivery-orders', deliveryOrderRouter);
app.use('/api/sales', saleEntryRouter);
app.use('/api/suppliers', supplierRouter);
app.use('/api/lpos', lpoRouter);
app.use('/api/grns', grnRouter);
app.use('/api/purchases', purchaseEntryRouter);
app.use('/api/account-heads', accountHeadRouter);
app.use('/api/account-parameters', accountsParameterRouter);
app.use('/api/app-parameters', appParameterRouter);
app.use('/api/vouchers', voucherRouter);
app.use('/api/stock-entries', stockEntryRouter);
app.use('/api/deals-offers', dealsOffersRouter);
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
app.use('/api/admin', adminRouter);
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

app.use((err, req, res, _next) => {
  const status = Number(err.status || err.statusCode) || 500;
  console.error(`[API ${status}] ${req.method} ${req.originalUrl} — ${err.message}`);
  if (err.code) console.error('  pg/code:', err.code, err.detail || '');
  if (status >= 500 || !err.status) console.error(err.stack || err);
  res.status(status >= 400 && status < 600 ? status : 500).json({
    message: err.message || 'Server error',
  });
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
  } catch (err) {
    console.error('');
    console.error('  [DB] FAILED — could not connect');
    console.error('  ', err.message);
    console.error('  Fix DATABASE_URL in api/.env and ensure PostgreSQL is running.');
    console.error('');
    await pool.end().catch(() => {});
    process.exit(1);
  }

  app.listen(config.port, () => {
    printBanner();
  });
}

start();
