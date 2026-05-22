import { Router } from 'express';
import { requirePlatformAuth } from '../../middleware/platformAuth.middleware.js';
import * as ctrl from '../controllers/platformAuth.controller.js';

export const platformAuthRouter = Router();

platformAuthRouter.post('/login', ctrl.login);
platformAuthRouter.post('/refresh', ctrl.refresh);
platformAuthRouter.get('/me', requirePlatformAuth, ctrl.me);
