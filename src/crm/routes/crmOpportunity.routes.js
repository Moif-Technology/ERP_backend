import { Router } from 'express';
import * as ctrl from '../controllers/crmOpportunity.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const crmOpportunityRouter = Router();
crmOpportunityRouter.use(authMiddleware);
crmOpportunityRouter.use(requireFeature('crm.opportunities'));
crmOpportunityRouter.get('/', ctrl.list);
crmOpportunityRouter.get('/:id', ctrl.getById);
crmOpportunityRouter.post('/', ctrl.create);
crmOpportunityRouter.put('/:id', ctrl.update);
crmOpportunityRouter.patch('/:id/status', ctrl.setStatus);
crmOpportunityRouter.delete('/:id', ctrl.remove);
