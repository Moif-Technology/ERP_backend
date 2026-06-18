import { Router } from 'express';
import * as ctrl from '../controllers/partRequest.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const partRequestRouter = Router();

partRequestRouter.use(authMiddleware);
partRequestRouter.get('/',               ctrl.listPartRequests);
partRequestRouter.get('/:id',            ctrl.getPartRequestById);
partRequestRouter.post('/',              ctrl.createPartRequest);
partRequestRouter.put('/:id',            ctrl.updatePartRequest);
partRequestRouter.patch('/:id/issue',    ctrl.issuePartRequest);
partRequestRouter.patch('/:id/cancel',   ctrl.cancelPartRequest);
