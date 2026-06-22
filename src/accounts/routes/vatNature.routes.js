import { Router } from 'express';
import * as vatNatureController from '../controllers/vatNature.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const vatNatureRouter = Router();

vatNatureRouter.use(authMiddleware);
vatNatureRouter.use(requireFeature('backoffice.accounts'));
vatNatureRouter.get('/', vatNatureController.listVatNatures);
