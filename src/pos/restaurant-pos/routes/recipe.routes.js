import { Router } from 'express';
import * as recipeController from '../controllers/recipe.controller.js';
import { requireAnyFeature } from '../../../middleware/entitlementMiddleware.js';

/** Mounted at /api/pos/recipes (after POS authMiddleware). */
export const recipeRouter = Router();

const feat = requireAnyFeature(['pos.recipe', 'pos']);

recipeRouter.get('/products', feat, recipeController.searchProducts);
recipeRouter.get('/', feat, recipeController.listRecipes);
recipeRouter.get('/:finishedProductId', feat, recipeController.getRecipe);
recipeRouter.put('/:finishedProductId', feat, recipeController.saveRecipe);
recipeRouter.delete('/:finishedProductId', feat, recipeController.deleteRecipe);
