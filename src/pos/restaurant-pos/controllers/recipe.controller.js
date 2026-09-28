import { pool } from '../../../config/db.js';
import * as recipeService from '../services/recipe.service.js';

function handleError(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ ok: false, message: err.message });
  if (err.code === '42P01') {
    return res.status(503).json({ ok: false, message: 'Recipe table is not installed. Run migration 120_recipe_detail.sql.' });
  }
  console.error('[pos recipe]', err);
  return res.status(500).json({ ok: false, message: err.message || fallback });
}

export async function searchProducts(req, res) {
  try {
    const products = await recipeService.searchProducts(pool, req.authStaff, req.query ?? {});
    return res.json({ ok: true, products });
  } catch (err) {
    return handleError(res, err, 'Could not search products');
  }
}

export async function listRecipes(req, res) {
  try {
    const recipes = await recipeService.listRecipes(pool, req.authStaff, req.query ?? {});
    return res.json({ ok: true, recipes });
  } catch (err) {
    return handleError(res, err, 'Could not load recipes');
  }
}

export async function getRecipe(req, res) {
  try {
    const recipe = await recipeService.getRecipe(
      pool,
      req.authStaff,
      req.params.finishedProductId,
      req.query ?? {},
    );
    return res.json({ ok: true, recipe });
  } catch (err) {
    return handleError(res, err, 'Could not load recipe');
  }
}

export async function saveRecipe(req, res) {
  try {
    const recipe = await recipeService.saveRecipe(
      pool,
      req.authStaff,
      req.params.finishedProductId,
      req.body ?? {},
    );
    return res.json({ ok: true, recipe });
  } catch (err) {
    return handleError(res, err, 'Could not save recipe');
  }
}

export async function deleteRecipe(req, res) {
  try {
    const result = await recipeService.deleteRecipe(
      pool,
      req.authStaff,
      req.params.finishedProductId,
      req.query ?? {},
    );
    return res.json({ ok: true, ...result });
  } catch (err) {
    return handleError(res, err, 'Could not delete recipe');
  }
}
