import { Router } from 'express';
import * as routeController from '../controllers/routeMaster.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature, requirePermission } from '../../middleware/entitlementMiddleware.js';

export const routeMasterRouter = Router();

routeMasterRouter.use(authMiddleware);
routeMasterRouter.use(requireFeature('van.route_master'));

routeMasterRouter.get('/', requirePermission('van.route_master.view'), routeController.listRoutes);
routeMasterRouter.post('/', requirePermission('van.route_master.create'), routeController.createRoute);
routeMasterRouter.patch('/:routeId/toggle', requirePermission('van.route_master.edit'), routeController.toggleRoute);
routeMasterRouter.patch('/:routeId', requirePermission('van.route_master.edit'), routeController.updateRoute);
routeMasterRouter.get('/:routeId/customers', requirePermission('van.assignment.view'), routeController.listRouteCustomers);
routeMasterRouter.post('/:routeId/customers', requirePermission('van.assignment.create'), routeController.setRouteCustomers);
routeMasterRouter.delete('/:routeId/customers/:custId', requirePermission('van.assignment.delete'), routeController.removeRouteCustomer);
