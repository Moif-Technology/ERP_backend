import { Router } from 'express';
import * as ctrl from '../controllers/crmNote.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const crmNoteRouter = Router();
crmNoteRouter.use(authMiddleware);
crmNoteRouter.use(requireFeature('crm.notes'));
crmNoteRouter.get('/', ctrl.list);
crmNoteRouter.get('/:id', ctrl.getById);
crmNoteRouter.post('/', ctrl.create);
crmNoteRouter.put('/:id', ctrl.update);
crmNoteRouter.delete('/:id', ctrl.remove);
