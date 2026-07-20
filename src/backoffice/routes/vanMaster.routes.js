import { Router } from 'express';
import * as vanController from '../controllers/vanMaster.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature, requirePermission } from '../../middleware/entitlementMiddleware.js';

export const vanMasterRouter = Router();

vanMasterRouter.use(authMiddleware);
vanMasterRouter.use(requireFeature('van.van_master'));

vanMasterRouter.get('/', requirePermission('van.van_master.view'), vanController.listVans);
vanMasterRouter.post('/', requirePermission('van.van_master.create'), vanController.createVan);
vanMasterRouter.patch('/:vanId/toggle', requirePermission('van.van_master.edit'), vanController.toggleVan);
vanMasterRouter.patch('/:vanId', requirePermission('van.van_master.edit'), vanController.updateVan);
