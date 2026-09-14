import { Router } from 'express';

import * as posController from './controllers/pos.controller.js';
import * as deviceAuthController from './controllers/deviceAuth.controller.js';
import { kotRouter } from './routes/kot.routes.js';
import { salesRouter } from './routes/sales.routes.js';

import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';



export const posRouter = Router();



posRouter.post('/login',      posController.login);
posRouter.post('/pin-login',  posController.pinLogin);
posRouter.post('/staff-list', posController.staffList);

// Device enrollment (Deyno Pro / Deyno Quick). Public — no staff JWT.
posRouter.post('/device/stations',   deviceAuthController.listStationsForEnroll);
posRouter.post('/device/enroll',     deviceAuthController.enrollDevice);
posRouter.post('/device/staff-list', deviceAuthController.staffList);
posRouter.post('/device/pin-login',  deviceAuthController.pinLogin);



posRouter.use(authMiddleware);
posRouter.use(requireFeature('pos'));

posRouter.use('/kot', kotRouter);

posRouter.use('/sales', salesRouter);

posRouter.get('/parameters', posController.getParameters);

posRouter.get('/parameter-definitions', posController.getParameterDefinitions);

posRouter.put('/parameters', posController.putParameters);

posRouter.put('/parameters/company-details', posController.putCompanyDetails);

posRouter.get('/privileges', posController.getPrivileges);


