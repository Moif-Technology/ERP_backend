import { Router } from 'express';
import * as supplierController from '../controllers/supplier.controller.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAnyFeature } from '../middleware/entitlementMiddleware.js';

export const supplierRouter = Router();

supplierRouter.use(authMiddleware);
supplierRouter.use(requireAnyFeature(['core.suppliers', 'backoffice.suppliers', 'backoffice.purchase']));
supplierRouter.get('/', supplierController.listSuppliers);
supplierRouter.post('/', supplierController.createSupplier);
supplierRouter.put('/:supplierId', supplierController.updateSupplier);
