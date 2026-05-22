import { Router } from 'express';
import * as ctrl from '../controllers/crmOpportunityStage.controller.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/entitlementMiddleware.js';

export const crmOpportunityStageRouter = Router();
crmOpportunityStageRouter.use(authMiddleware);
crmOpportunityStageRouter.use(requireFeature('crm.opportunity_stages'));
crmOpportunityStageRouter.get('/', ctrl.list);
crmOpportunityStageRouter.post('/', ctrl.create);
crmOpportunityStageRouter.put('/:id', ctrl.update);
crmOpportunityStageRouter.delete('/:id', ctrl.remove);
