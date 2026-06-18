import { Router } from 'express';
import * as grnController from '../controllers/grn.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const grnRouter = Router();

grnRouter.use(authMiddleware);
grnRouter.use(requireFeature('backoffice.grn'));
grnRouter.get('/', grnController.listGrns);
grnRouter.post('/', grnController.createGrn);
grnRouter.get('/:grnId', grnController.getGrn);
