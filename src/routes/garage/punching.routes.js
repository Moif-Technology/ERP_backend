import { Router } from 'express';
import * as ctrl from '../../controllers/garage/punching.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const punchingRouter = Router();

punchingRouter.use(authMiddleware);
punchingRouter.get('/', ctrl.listPunchings);
punchingRouter.get('/by-jobcard/:jcNo', ctrl.getPunchingsByJobCard);
punchingRouter.get('/:id', ctrl.getPunchingById);
punchingRouter.post('/', ctrl.createPunching);
punchingRouter.put('/:id', ctrl.updatePunching);
punchingRouter.patch('/:id/cancel', ctrl.cancelPunching);
