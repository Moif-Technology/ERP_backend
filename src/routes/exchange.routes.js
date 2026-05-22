import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireFeature, requirePermission } from '../middleware/entitlementMiddleware.js';
import * as exchangeController from '../controllers/exchange.controller.js';

export const exchangeRouter = Router();

exchangeRouter.use(authMiddleware);
exchangeRouter.use(requireFeature('backoffice.exchange'));

// Currency master
exchangeRouter.get(
  '/currencies',
  requirePermission('backoffice.exchange.view'),
  exchangeController.listCurrencies
);
exchangeRouter.post(
  '/currencies/:code/activate',
  requirePermission('backoffice.exchange.edit'),
  exchangeController.activateCurrency
);
exchangeRouter.post(
  '/currencies/:code/deactivate',
  requirePermission('backoffice.exchange.edit'),
  exchangeController.deactivateCurrency
);
exchangeRouter.post(
  '/currencies/:code/set-base',
  requirePermission('backoffice.exchange.edit'),
  exchangeController.setBaseCurrency
);

// Exchange rates — /latest must come before /:rateId to avoid route conflict
exchangeRouter.get(
  '/rates/latest',
  requirePermission('backoffice.exchange.view'),
  exchangeController.getLatestRate
);
exchangeRouter.get(
  '/rates',
  requirePermission('backoffice.exchange.view'),
  exchangeController.listRates
);
exchangeRouter.post(
  '/rates',
  requirePermission('backoffice.exchange.create'),
  exchangeController.createRate
);
exchangeRouter.put(
  '/rates/:rateId',
  requirePermission('backoffice.exchange.edit'),
  exchangeController.updateRate
);
exchangeRouter.delete(
  '/rates/:rateId',
  requirePermission('backoffice.exchange.delete'),
  exchangeController.deleteRate
);
