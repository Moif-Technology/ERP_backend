import { Router } from 'express';
import * as staffController from '../controllers/staff.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requirePermission } from '../../middleware/entitlementMiddleware.js';

export const staffRouter = Router();

staffRouter.use(authMiddleware);
staffRouter.get('/branches', requirePermission('backoffice.staff.view'), staffController.listBranches);
staffRouter.get('/members', requirePermission('backoffice.staff.view'), staffController.listStaff);
staffRouter.patch('/members/:staffId', requirePermission('backoffice.staff.edit'), staffController.updateStaff);
staffRouter.patch('/members/:staffId/role', requirePermission('backoffice.staff.edit'), staffController.updateStaffRole);
staffRouter.patch('/members/:staffId/password', requirePermission('backoffice.staff.edit'), staffController.resetStaffPassword);
staffRouter.post('/', requirePermission('backoffice.staff.create'), staffController.createStaff);
staffRouter.patch('/members/:staffId/pin', requirePermission('backoffice.staff.edit'), staffController.setStaffPin);
