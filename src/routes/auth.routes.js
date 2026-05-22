import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

export const authRouter = Router();

authRouter.post('/register', authController.register);
authRouter.post('/login', authController.login);
authRouter.post('/logout', authController.logout);
authRouter.get('/me', authMiddleware, authController.me);
authRouter.get('/access/version', authMiddleware, authController.accessVersion);
authRouter.get('/access/refresh', authMiddleware, authController.accessRefresh);
authRouter.post('/welcome/complete', authMiddleware, authController.completeWelcome);
authRouter.post('/refresh', authController.refresh);
authRouter.post('/forgot-password', authController.forgotPassword);
authRouter.post('/reset-password', authController.resetPassword);
