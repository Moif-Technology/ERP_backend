import { Router } from 'express';
import * as tableController from '../controllers/table.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const tableRouter = Router();

tableRouter.use(authMiddleware);
tableRouter.get(
  '/',
  requireAnyFeature(['backoffice.table_master', 'pos.tables', 'pos.kot']),
  tableController.listTables
);
tableRouter.post(
  '/',
  requireAnyFeature(['backoffice.table_master', 'pos.tables']),
  tableController.createTable
);
