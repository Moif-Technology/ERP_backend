import * as recipeService from '../../../backoffice/services/recipe.service.js';

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** Station on the till maps to the branch that owns recipe lines and finished-item cost. */
async function staffForBranch(pool, authStaff, query = {}) {
  const companyId = num(authStaff?.company_id, 0);
  const stationId = num(authStaff?.station_id, 0) || num(query?.stationId, 0);
  let branchId = 0;
  if (companyId > 0 && stationId > 0) {
    const { rows } = await pool.query(
      `SELECT branch_id
         FROM core.station_master
        WHERE company_id = $1 AND station_id = $2 AND is_deleted = FALSE
        LIMIT 1`,
      [companyId, stationId],
    );
    branchId = num(rows[0]?.branch_id, 0);
  }
  if (branchId < 1) branchId = num(authStaff?.branch_id, 0);
  if (companyId < 1 || branchId < 1) {
    const err = new Error('Company / branch missing');
    err.status = 400;
    throw err;
  }
  return {
    ...authStaff,
    company_id: companyId,
    branch_id: branchId,
  };
}

export async function searchProducts(pool, authStaff, query) {
  const staff = await staffForBranch(pool, authStaff, query);
  return recipeService.searchProducts(pool, staff, query);
}

export async function listRecipes(pool, authStaff, query) {
  const staff = await staffForBranch(pool, authStaff, query);
  return recipeService.listRecipes(pool, staff, query);
}

export async function getRecipe(pool, authStaff, finishedProductId, query) {
  const staff = await staffForBranch(pool, authStaff, query);
  return recipeService.getRecipe(pool, staff, finishedProductId);
}

export async function saveRecipe(pool, authStaff, finishedProductId, body) {
  const staff = await staffForBranch(pool, authStaff, body);
  return recipeService.saveRecipe(pool, staff, finishedProductId, body);
}

export async function deleteRecipe(pool, authStaff, finishedProductId, query) {
  const staff = await staffForBranch(pool, authStaff, query);
  return recipeService.deleteRecipe(pool, staff, finishedProductId);
}
