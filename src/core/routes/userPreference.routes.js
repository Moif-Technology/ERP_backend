import { Router } from 'express';
import * as userPreferenceController from '../controllers/userPreference.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const userPreferenceRouter = Router();

userPreferenceRouter.use(authMiddleware);
userPreferenceRouter.get('/', userPreferenceController.getPreference);
userPreferenceRouter.put('/', userPreferenceController.savePreference);
