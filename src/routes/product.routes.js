import { Router } from 'express';
import * as productController from '../controllers/product.controller.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAnyFeature } from '../middleware/entitlementMiddleware.js';

export const productRouter = Router();

productRouter.use(authMiddleware);
productRouter.use(requireAnyFeature(['backoffice.product_master', 'pos.product_search']));

productRouter.get('/',      productController.listProducts);
productRouter.post('/',     productController.createProduct);
productRouter.get('/:id',   productController.getProduct);    // ← NEW
productRouter.put('/:id',   productController.updateProduct); // ← NEW
