import { Router } from 'express';
import * as printerController from '../controllers/printer.controller.js';
import { requireFeature } from '../../../middleware/entitlementMiddleware.js';

/**
 * Mounted at /api/pos/printers (after POS authMiddleware in pos.routes.js).
 * Config + print-job lifecycle, all scoped to the token's company + station.
 */
export const printerRouter = Router();

// Printer configuration.
printerRouter.get('/', requireFeature('pos.kot'), printerController.listPrinters);
printerRouter.post('/', requireFeature('pos.kot'), printerController.savePrinter);
printerRouter.delete('/:printerId', requireFeature('pos.kot'), printerController.deletePrinter);

// Print-job lifecycle.
printerRouter.post('/jobs/kot', requireFeature('pos.kot'), printerController.createKotJobs);
printerRouter.post('/jobs/:jobId/claim', requireFeature('pos.kot'), printerController.claimJob);
printerRouter.patch('/jobs/:jobId', requireFeature('pos.kot'), printerController.updateJobStatus);
printerRouter.get('/jobs/kot/:kotMasterId', requireFeature('pos.kot'), printerController.listKotJobs);
