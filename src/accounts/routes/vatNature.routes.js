import { Router } from 'express';
import * as vatNatureController from '../controllers/vatNature.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const vatNatureRouter = Router();

vatNatureRouter.use(authMiddleware);
vatNatureRouter.use(requireAnyFeature(['backoffice.accounts', 'accounts', 'accounts.ledger', 'accounts.vouchers']));
vatNatureRouter.get('/', vatNatureController.listVatNatures);
