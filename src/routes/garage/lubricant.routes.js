import { Router } from 'express';
import * as ctrl from '../../controllers/garage/lubricant.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const lubricantRouter = Router();

lubricantRouter.use(authMiddleware);
lubricantRouter.get('/', ctrl.listLubricants);
lubricantRouter.get('/:id', ctrl.getLubricantById);
lubricantRouter.post('/', ctrl.createLubricant);
lubricantRouter.put('/:id', ctrl.updateLubricant);
lubricantRouter.delete('/:id', ctrl.deleteLubricant);
