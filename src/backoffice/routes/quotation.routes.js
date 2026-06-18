import { Router } from 'express';
import * as quotationController from '../controllers/quotation.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const quotationRouter = Router();

quotationRouter.use(authMiddleware);
quotationRouter.use(requireFeature('backoffice.sales_quotation'));
quotationRouter.post('/', quotationController.createQuotation);
quotationRouter.get('/', quotationController.listQuotations);
quotationRouter.get('/:quotationId', quotationController.getQuotation);
