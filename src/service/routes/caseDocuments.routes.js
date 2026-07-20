import { Router } from 'express';
import * as ctrl from '../controllers/case.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const serviceDocumentsRouter = Router();
serviceDocumentsRouter.use(authMiddleware);
serviceDocumentsRouter.use(requireFeature('service.documents'));
serviceDocumentsRouter.get('/', ctrl.listAllDocuments);
