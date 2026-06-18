import { Router } from 'express';
import * as ctrl from '../controllers/crmLeadStatus.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const crmLeadStatusRouter = Router();
crmLeadStatusRouter.use(authMiddleware);
crmLeadStatusRouter.use(requireFeature('crm.lead_statuses'));
crmLeadStatusRouter.get('/', ctrl.list);
crmLeadStatusRouter.post('/', ctrl.create);
crmLeadStatusRouter.put('/:id', ctrl.update);
crmLeadStatusRouter.delete('/:id', ctrl.remove);
