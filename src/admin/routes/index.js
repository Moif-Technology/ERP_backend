import { Router } from 'express';
import { platformAuthRouter } from './platformAuth.routes.js';
import { tenantAdminRouter } from './tenant.routes.js';
import { catalogRouter } from './catalog.routes.js';
import { adminFeatureRouter } from './featureAdmin.routes.js';

export const adminRouter = Router();

adminRouter.use('/auth', platformAuthRouter);
adminRouter.use('/tenants', tenantAdminRouter);
adminRouter.use('/catalog', catalogRouter);
adminRouter.use('/features', adminFeatureRouter);
