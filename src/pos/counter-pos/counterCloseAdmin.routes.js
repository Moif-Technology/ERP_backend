import { Router } from 'express';
import * as counterController from './controllers/counter.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';
import { DEFAULT_ROLE_IDS } from '../../core/repositories/role.repository.js';

/** ERP back-office: Counter Close List / Counter Close pages. Admin role only. */
function requireAdminRole(req, res, next) {
  if (Number(req.authStaff?.role_id) !== DEFAULT_ROLE_IDS.admin) {
    return res.status(403).json({ message: 'Admin only' });
  }
  next();
}

export const counterCloseAdminRouter = Router();

const guard = [authMiddleware, requireAnyFeature(['pos.counter_open_close', 'backoffice.sales']), requireAdminRole];

counterCloseAdminRouter.get('/',         ...guard, counterController.listCounterClosesAdmin);
counterCloseAdminRouter.get('/:closeId', ...guard, counterController.getCounterCloseAdmin);
