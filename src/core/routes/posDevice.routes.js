import { Router } from 'express';
import * as controller from '../controllers/posDevice.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const posDeviceRouter = Router();

posDeviceRouter.use(authMiddleware);
posDeviceRouter.get('/', requireAnyFeature(['pos', 'core.settings']), controller.listDevices);
posDeviceRouter.patch('/:deviceId', requireAnyFeature(['pos', 'core.settings']), controller.updateDevice);
