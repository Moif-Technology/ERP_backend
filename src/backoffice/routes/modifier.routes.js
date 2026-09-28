import { Router } from 'express';
import * as modifierController from '../controllers/modifier.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const modifierRouter = Router();

modifierRouter.use(authMiddleware);
modifierRouter.use(
  requireAnyFeature([
    'backoffice.product_group',
    'pos.product_search',
    'pos.kitchen_message',
    'pos.notes',
    'pos.ui.cart.modifier',
  ]),
);
modifierRouter.get('/', modifierController.listModifiers);
