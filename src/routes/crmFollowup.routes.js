import { Router } from 'express';
import * as ctrl from '../controllers/crmFollowup.controller.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/entitlementMiddleware.js';

export const crmFollowupRouter = Router();
crmFollowupRouter.use(authMiddleware);
crmFollowupRouter.use(requireFeature('crm.followups'));
crmFollowupRouter.get('/', ctrl.list);
crmFollowupRouter.get('/:id', ctrl.getById);
crmFollowupRouter.post('/', ctrl.create);
crmFollowupRouter.put('/:id', ctrl.update);
crmFollowupRouter.patch('/:id/complete', ctrl.complete);
crmFollowupRouter.delete('/:id', ctrl.remove);
