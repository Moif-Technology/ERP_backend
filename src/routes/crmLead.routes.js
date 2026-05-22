import { Router } from 'express';
import * as ctrl from '../controllers/crmLead.controller.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/entitlementMiddleware.js';

export const crmLeadRouter = Router();
crmLeadRouter.use(authMiddleware);
crmLeadRouter.use(requireFeature('crm.leads'));
crmLeadRouter.get('/', ctrl.list);
crmLeadRouter.get('/:id', ctrl.getById);
crmLeadRouter.post('/', ctrl.create);
crmLeadRouter.put('/:id', ctrl.update);
crmLeadRouter.delete('/:id', ctrl.remove);
