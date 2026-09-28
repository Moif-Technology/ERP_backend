import { Router } from 'express';
import * as recipeController from '../controllers/recipe.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/entitlementMiddleware.js';

export const recipeRouter = Router();

recipeRouter.use(authMiddleware);
recipeRouter.use(requireFeature('backoffice.manufacturing'));

recipeRouter.get('/products', recipeController.searchProducts);
recipeRouter.get('/', recipeController.listRecipes);
recipeRouter.get('/:finishedProductId', recipeController.getRecipe);
recipeRouter.put('/:finishedProductId', recipeController.saveRecipe);
recipeRouter.delete('/:finishedProductId', recipeController.deleteRecipe);
