import { Router } from 'express';
import * as ctrl from '../controllers/crmLeadSource.controller.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/entitlementMiddleware.js';

export const crmLeadSourceRouter = Router();
crmLeadSourceRouter.use(authMiddleware);
crmLeadSourceRouter.use(requireFeature('crm.lead_sources'));
crmLeadSourceRouter.get('/', ctrl.list);
crmLeadSourceRouter.post('/', ctrl.create);
crmLeadSourceRouter.put('/:id', ctrl.update);
crmLeadSourceRouter.delete('/:id', ctrl.remove);
