import { Router } from 'express';
import * as companyController from '../controllers/company.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature, requirePermission } from '../../middleware/entitlementMiddleware.js';

export const companyRouter = Router();

companyRouter.use(authMiddleware);
companyRouter.use(requireFeature('core.company_profile'));
companyRouter.get('/profile', requirePermission('core.company_profile.view'), companyController.getProfile);
companyRouter.put('/profile', requirePermission('core.company_profile.edit'), companyController.updateProfile);
