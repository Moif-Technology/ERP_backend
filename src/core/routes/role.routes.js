import { Router } from 'express';
import * as roleController from '../controllers/role.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requirePermission } from '../../middleware/entitlementMiddleware.js';

export const roleRouter = Router();

roleRouter.use(authMiddleware);
roleRouter.get('/', requirePermission('core.roles.view'), roleController.listRoles);
roleRouter.post('/', requirePermission('core.roles.create'), roleController.createRole);
roleRouter.get('/permissions', requirePermission('core.permissions.view'), roleController.listPermissionCatalog);
roleRouter.put('/:roleId', requirePermission('core.roles.edit'), roleController.updateRole);
roleRouter.delete('/:roleId', requirePermission('core.roles.delete'), roleController.deactivateRole);
roleRouter.get('/:roleId/permissions', requirePermission('core.roles.view'), roleController.getRolePermissions);
roleRouter.put('/:roleId/permissions', requirePermission('core.roles.edit'), roleController.updateRolePermissions);
roleRouter.get('/my-access', roleController.getMyAccess);
roleRouter.get('/:roleId/pages', roleController.getRolePages);
roleRouter.put('/:roleId/pages', roleController.setRolePages);
