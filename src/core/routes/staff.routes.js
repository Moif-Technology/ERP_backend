import { Router } from 'express';
import * as staffController from '../controllers/staff.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const staffRouter = Router();

staffRouter.use(authMiddleware);
staffRouter.get('/branches', requireAnyFeature(['core.branches', 'backoffice.staff']), staffController.listBranches);
staffRouter.get('/members', requireAnyFeature(['core.users', 'backoffice.staff']), staffController.listStaff);
staffRouter.patch('/members/:staffId', requireAnyFeature(['core.users', 'backoffice.staff']), staffController.updateStaff);
staffRouter.patch('/members/:staffId/role', requireAnyFeature(['core.users', 'backoffice.staff']), staffController.updateStaffRole);
staffRouter.patch('/members/:staffId/password', requireAnyFeature(['core.users', 'backoffice.staff']), staffController.resetStaffPassword);
staffRouter.post('/', requireAnyFeature(['core.users', 'backoffice.staff']), staffController.createStaff);
staffRouter.patch('/members/:staffId/pin', requireAnyFeature(['core.users', 'backoffice.staff']), staffController.setStaffPin);
