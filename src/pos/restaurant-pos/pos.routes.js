import { Router } from 'express';

import * as posController from './controllers/pos.controller.js';
import { kotRouter } from './routes/kot.routes.js';
import { salesRouter } from './routes/sales.routes.js';

import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';



export const posRouter = Router();



posRouter.post('/login',      posController.login);
posRouter.post('/pin-login',  posController.pinLogin);
posRouter.post('/staff-list', posController.staffList);



posRouter.use(authMiddleware);
posRouter.use(requireFeature('pos'));

posRouter.use('/kot', kotRouter);

posRouter.use('/sales', salesRouter);

posRouter.get('/parameters', posController.getParameters);

posRouter.get('/parameter-definitions', posController.getParameterDefinitions);

posRouter.put('/parameters', posController.putParameters);

posRouter.put('/parameters/company-details', posController.putCompanyDetails);

posRouter.get('/privileges', posController.getPrivileges);


