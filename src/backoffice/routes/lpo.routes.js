import { Router } from 'express';
import * as lpoController from '../controllers/lpo.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const lpoRouter = Router();

lpoRouter.use(authMiddleware);
lpoRouter.use(requireFeature('backoffice.purchase_order'));
lpoRouter.get('/', lpoController.listLpos);
lpoRouter.post('/', lpoController.createLpo);
lpoRouter.put('/:lpoMasterId', lpoController.updateLpo);
lpoRouter.get('/:lpoMasterId', lpoController.getLpo);
