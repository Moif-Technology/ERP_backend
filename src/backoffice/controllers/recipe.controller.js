import { pool } from '../../config/db.js';
import * as recipeService from '../services/recipe.service.js';

function handleErr(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.code === '42P01') {
    return res.status(503).json({ message: 'Recipe table is not installed. Run migration 120_recipe_detail.sql.' });
  }
  if (err.code === '42703') {
    return res.status(500).json({ message: 'Recipe save failed because a product column is missing.' });
  }
  console.error(err);
  return res.status(500).json({ message: fallback });
}

export async function searchProducts(req, res) {
  try {
    const products = await recipeService.searchProducts(pool, req.authStaff, req.query);
    return res.json({ products });
  } catch (err) {
    return handleErr(res, err, 'Could not search products');
  }
}

export async function listRecipes(req, res) {
  try {
    const recipes = await recipeService.listRecipes(pool, req.authStaff, req.query);
    return res.json({ recipes });
  } catch (err) {
    return handleErr(res, err, 'Could not load recipes');
  }
}

export async function getRecipe(req, res) {
  try {
    const recipe = await recipeService.getRecipe(pool, req.authStaff, req.params.finishedProductId);
    return res.json({ recipe });
  } catch (err) {
    return handleErr(res, err, 'Could not load recipe');
  }
}

export async function saveRecipe(req, res) {
  try {
    const recipe = await recipeService.saveRecipe(
      pool,
      req.authStaff,
      req.params.finishedProductId,
      req.body || {},
    );
    return res.json({ recipe });
  } catch (err) {
    return handleErr(res, err, 'Could not save recipe');
  }
}

export async function deleteRecipe(req, res) {
  try {
    const result = await recipeService.deleteRecipe(pool, req.authStaff, req.params.finishedProductId);
    return res.json(result);
  } catch (err) {
    return handleErr(res, err, 'Could not delete recipe');
  }
}
