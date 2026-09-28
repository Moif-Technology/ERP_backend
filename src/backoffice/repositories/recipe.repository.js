const PRODUCT_COLS = `m.product_id, m.product_code, m.barcode, m.product_name, m.short_name,
  m.product_type, m.pack_qty, m.pack_description, m.unit_name`;

function roleFilter(role) {
  const type = `UPPER(TRIM(COALESCE(m.product_type, '')))`;
  if (role === 'finished') return `${type} <> 'RAW MATERIAL'`;
  if (role === 'raw') return `${type} = 'RAW MATERIAL'`;
  return `${type} <> 'NORMAL'`;
}

export async function searchProducts(client, { companyId, branchId, role, barcode, search, exact }) {
  const params = [companyId, branchId];
  const extra = [roleFilter(role)];

  if (barcode) {
    params.push(String(barcode).trim());
    extra.push(`m.barcode = $${params.length}`);
  } else if (search) {
    const text = String(search).trim();
    if (exact) {
      params.push(text.toLowerCase());
      const p = `$${params.length}`;
      extra.push(`(LOWER(COALESCE(m.short_name, '')) = ${p} OR LOWER(COALESCE(m.product_name, '')) = ${p})`);
    } else {
      params.push(`${text.toLowerCase()}%`);
      const p = `$${params.length}`;
      extra.push(`(
        LOWER(COALESCE(m.product_name, '')) LIKE ${p}
        OR LOWER(COALESCE(m.short_name, '')) LIKE ${p}
        OR LOWER(COALESCE(m.barcode, '')) LIKE ${p}
        OR LOWER(COALESCE(m.product_code, '')) LIKE ${p}
      )`);
    }
  }

  const { rows } = await client.query(
    `SELECT ${PRODUCT_COLS},
            i.average_cost,
            i.unique_multi_product_id
     FROM core.product_master m
     INNER JOIN core.product_inventory i
       ON i.company_id = m.company_id AND i.product_id = m.product_id AND i.branch_id = $2
     WHERE m.company_id = $1
       AND m.record_status = 'ACTIVE'
       AND i.record_status = 'ACTIVE'
       AND ${extra.join(' AND ')}
     ORDER BY m.product_name ASC
     LIMIT 50`,
    params,
  );
  return rows;
}

export async function getProductForRecipe(client, companyId, branchId, productId) {
  const { rows } = await client.query(
    `SELECT ${PRODUCT_COLS},
            i.average_cost,
            i.unique_multi_product_id
     FROM core.product_master m
     INNER JOIN core.product_inventory i
       ON i.company_id = m.company_id AND i.product_id = m.product_id AND i.branch_id = $2
     WHERE m.company_id = $1
       AND m.product_id = $3
       AND m.record_status = 'ACTIVE'
       AND i.record_status = 'ACTIVE'
     LIMIT 1`,
    [companyId, branchId, productId],
  );
  return rows[0] ?? null;
}

export async function listRecipes(client, companyId, branchId, { search, barcode }) {
  const params = [companyId, branchId];
  const extra = [];
  if (barcode) {
    params.push(`${String(barcode).trim().toLowerCase()}%`);
    extra.push(`LOWER(COALESCE(m.barcode, '')) LIKE $${params.length}`);
  }
  if (search) {
    params.push(`${String(search).trim().toLowerCase()}%`);
    const p = `$${params.length}`;
    extra.push(`(LOWER(COALESCE(m.product_name, '')) LIKE ${p} OR LOWER(COALESCE(m.short_name, '')) LIKE ${p})`);
  }
  const where = extra.length ? `AND ${extra.join(' AND ')}` : '';
  const { rows } = await client.query(
    `SELECT m.product_id, m.barcode, m.product_name, m.short_name, m.product_type,
            COUNT(*)::int AS line_count,
            COALESCE(SUM(r.raw_material_cost), 0) AS unit_cost_total,
            MAX(r.remarks) AS remarks,
            MAX(r.modified_at) AS modified_at
     FROM core.recipe_detail r
     INNER JOIN core.product_master m
       ON m.company_id = r.company_id AND m.product_id = r.finished_product_id
     WHERE r.company_id = $1
       AND r.branch_id = $2
       AND r.record_status = 'ACTIVE'
       AND COALESCE(r.is_deleted, FALSE) = FALSE
       AND UPPER(TRIM(COALESCE(m.product_type, ''))) <> 'RAW MATERIAL'
       ${where}
     GROUP BY m.product_id, m.barcode, m.product_name, m.short_name, m.product_type
     ORDER BY m.product_name ASC`,
    params,
  );
  return rows;
}

export async function listRecipeLines(client, companyId, branchId, finishedProductId) {
  const { rows } = await client.query(
    `SELECT r.recipe_detail_id, r.finished_product_id, r.finished_product_unique_id,
            r.raw_material_id, r.raw_material_unique_id, r.recipe_qty, r.unit_name,
            r.remarks, r.raw_material_cost,
            m.barcode, m.product_name, m.short_name, m.pack_qty, m.pack_description,
            m.product_type
     FROM core.recipe_detail r
     INNER JOIN core.product_master m
       ON m.company_id = r.company_id AND m.product_id = r.raw_material_id
     WHERE r.company_id = $1
       AND r.branch_id = $2
       AND r.finished_product_id = $3
       AND r.record_status = 'ACTIVE'
       AND COALESCE(r.is_deleted, FALSE) = FALSE
     ORDER BY r.recipe_detail_id ASC`,
    [companyId, branchId, finishedProductId],
  );
  return rows;
}

export async function deleteRecipeLines(client, companyId, branchId, finishedProductId) {
  const { rowCount } = await client.query(
    `DELETE FROM core.recipe_detail
     WHERE company_id = $1 AND branch_id = $2 AND finished_product_id = $3`,
    [companyId, branchId, finishedProductId],
  );
  return rowCount;
}

export async function nextRecipeDetailId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(recipe_detail_id), 0) + 1 AS n
     FROM core.recipe_detail WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].n);
}

export async function insertRecipeLine(client, row) {
  await client.query(
    `INSERT INTO core.recipe_detail (
        company_id, recipe_detail_id, recipe_no, branch_id,
        finished_product_id, finished_product_unique_id,
        raw_material_id, raw_material_unique_id,
        recipe_qty, unit_name, remarks, raw_material_cost,
        sync_status, server_status, record_status,
        created_by, modified_by
      ) VALUES (
        $1, $2, 0, $3,
        $4, $5,
        $6, $7,
        $8, $9, $10, $11,
        'PENDING', 'PENDING', 'ACTIVE',
        $12, $12
      )`,
    [
      row.companyId,
      row.recipeDetailId,
      row.branchId,
      row.finishedProductId,
      row.finishedProductUniqueId,
      row.rawMaterialId,
      row.rawMaterialUniqueId,
      row.recipeQty,
      row.unitName,
      row.remarks,
      row.rawMaterialCost,
      row.staffId,
    ],
  );
}

export async function updateFinishedProductCost(client, {
  companyId, branchId, productId, unitCost, inputTaxAmount, inputTaxRate, userName,
}) {
  const { rowCount } = await client.query(
    `UPDATE core.product_inventory
     SET last_purchase_cost = $4,
         average_cost = $4,
         input_tax_1_amount = $5,
         input_tax_1_rate = $6,
         server_status = 'PENDING',
         modified_by = $7,
         modified_at = NOW()
     WHERE company_id = $1 AND branch_id = $2 AND product_id = $3`,
    [companyId, branchId, productId, unitCost, inputTaxAmount, inputTaxRate, userName],
  );
  return rowCount;
}

export async function updateSupplierCost(client, { companyId, branchId, productId, unitCost, staffId }) {
  const rel = await client.query(`SELECT to_regclass('core.product_supplier') AS name`);
  if (!rel.rows[0]?.name) return 0;
  const { rowCount } = await client.query(
    `UPDATE core.product_supplier
     SET unit_cost = $4,
         base_cost = $4,
         modified_by = $5,
         modified_at = NOW(),
         server_status = 'PENDING'
     WHERE company_id = $1 AND branch_id = $2 AND product_id = $3`,
    [companyId, branchId, productId, unitCost, staffId],
  );
  return rowCount;
}
