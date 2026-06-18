import { Router } from 'express';
import * as tableController from '../controllers/table.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const tableRouter = Router();

tableRouter.use(authMiddleware);
tableRouter.use(requireAnyFeature(['backoffice.table_master', 'pos.tables']));
tableRouter.get('/', tableController.listTables);
tableRouter.post('/', tableController.createTable);
