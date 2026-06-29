import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';
import * as controller from '../controllers/tools.controller.js';

export const toolsRouter = Router();
toolsRouter.use(authMiddleware);
toolsRouter.use(requireFeature('core.settings'));

toolsRouter.post('/import', controller.importRows);
toolsRouter.get('/exports/:entityType', controller.exportData);
toolsRouter.get('/jobs', controller.jobs);
toolsRouter.get('/audit', controller.audit);
toolsRouter.get('/system-logs', controller.systemLogs);
toolsRouter.get('/duplicates/:entityType', controller.duplicates);
toolsRouter.patch('/bulk-update/products', controller.bulkUpdate);
toolsRouter.get('/labels/products', controller.labels);
toolsRouter.get('/sequences', controller.sequences);
toolsRouter.get('/backup', controller.backup);
toolsRouter.post('/restore', controller.restore);
