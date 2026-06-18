import { Router } from 'express';
import * as branchController from '../controllers/branch.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const branchRouter = Router();

branchRouter.use(authMiddleware);
branchRouter.get('/',           requireAnyFeature(['core.users', 'core.branches', 'backoffice.staff']), branchController.listBranches);
branchRouter.post('/',          requireAnyFeature(['core.users']), branchController.createBranch);
branchRouter.patch('/:branchId', requireAnyFeature(['core.users']), branchController.updateBranch);
branchRouter.delete('/:branchId', requireAnyFeature(['core.users']), branchController.deleteBranch);
