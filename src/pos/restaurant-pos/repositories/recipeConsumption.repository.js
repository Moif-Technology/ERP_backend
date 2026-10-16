/**
 * Sale-time recipe breakdown.
 * core.recipe_detail is the recipe. ops.recipe_transaction is the consumption
 * written for one settled sales line (legacy RecipeTransaction).
 */

export async function listRecipeLinesForSale(client, companyId, branchId, finishedProductIds) {
  const { rows } = await client.query(
    `SELECT r.finished_product_id,
            r.branch_id,
            r.raw_material_id,
            r.raw_material_unique_id,
            r.recipe_qty,
            COALESCE(i.average_cost, 0) AS average_cost,
            COALESCE(rm.short_name, rm.product_name, '') AS raw_name,
            COALESCE(rm.stock_type, '') AS stock_type
       FROM core.recipe_detail r
       LEFT JOIN core.product_master rm
         ON rm.company_id = r.company_id
        AND rm.product_id = r.raw_material_id
       LEFT JOIN core.product_inventory i
         ON i.company_id = r.company_id
        AND i.branch_id = $2
        AND i.product_id = r.raw_material_id
      WHERE r.company_id = $1
        AND r.finished_product_id = ANY($3::bigint[])
        AND COALESCE(r.is_deleted, FALSE) = FALSE
      ORDER BY r.finished_product_id,
               CASE WHEN r.branch_id = $2 THEN 0 ELSE 1 END,
               r.branch_id,
               r.recipe_detail_id`,
    [companyId, branchId, finishedProductIds],
  );
  return rows;
}

export async function nextRecipeTransactionId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(recipe_transaction_id), 0) + 1 AS n
       FROM ops.recipe_transaction
      WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].n);
}

export async function insertRecipeTransaction(client, row) {
  await client.query(
    `INSERT INTO ops.recipe_transaction (
        company_id, recipe_transaction_id, branch_id,
        sales_id, sales_child_id,
        finished_product_id, finished_unique_id,
        recipe_product_id, recipe_unique_id,
        recipe_qty, pack_qty,
        created_by, modified_by, server_status
      ) VALUES (
        $1, $2, $3,
        $4, $5,
        $6, $7,
        $8, $9,
        $10, 1,
        $11, $11, 'PENDING'
      )`,
    [
      row.companyId,
      row.recipeTransactionId,
      row.branchId,
      row.salesId,
      row.salesChildId,
      row.finishedProductId,
      row.finishedUniqueId,
      row.recipeProductId,
      row.recipeUniqueId,
      row.recipeQty,
      row.staffId ?? null,
    ],
  );
}
