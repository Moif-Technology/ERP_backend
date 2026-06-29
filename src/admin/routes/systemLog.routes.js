import { Router } from 'express';
import { requirePlatformAuth, requireCapability } from '../../middleware/platformAuth.middleware.js';
import * as controller from '../controllers/systemLog.controller.js';

export const systemLogAdminRouter = Router();
systemLogAdminRouter.use(requirePlatformAuth);
systemLogAdminRouter.get('/', requireCapability('audit.read'), controller.list);
