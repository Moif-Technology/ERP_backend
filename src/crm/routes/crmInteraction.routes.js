import { Router } from 'express';
import * as ctrl from '../controllers/crmInteraction.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const crmInteractionRouter = Router();
crmInteractionRouter.use(authMiddleware);
crmInteractionRouter.use(requireFeature('crm.interactions'));
crmInteractionRouter.get('/', ctrl.list);
crmInteractionRouter.get('/:id', ctrl.getById);
crmInteractionRouter.post('/', ctrl.create);
crmInteractionRouter.put('/:id', ctrl.update);
crmInteractionRouter.delete('/:id', ctrl.remove);
