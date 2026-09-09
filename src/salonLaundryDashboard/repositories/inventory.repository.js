/**
 * Inventory Repository — Database queries for stock management.
 * Read-only queries.
 */

export async function getStockLevels(client, { companyId, branchId }) {
  const query = `
    SELECT
      pm.product_id as item_id,
      pm.product_name as name,
      pm.product_code as sku,
      COALESCE(sm.qty_on_hand, 0) as current_stock,
      COALESCE(sm.reorder_qty, sm.reorder_level, 10) as minimum_stock,
      COALESCE(sm.reorder_level, sm.reorder_qty, 20) as reorder_level,
      pm.unit_name as unit,
      CASE
        WHEN COALESCE(sm.qty_on_hand, 0) <= COALESCE(sm.reorder_qty, sm.reorder_level, 10) THEN 'critical'
        WHEN COALESCE(sm.qty_on_hand, 0) <= COALESCE(sm.reorder_level, sm.reorder_qty, 20) THEN 'low'
        ELSE 'ok'
      END as status
    FROM
      core.product_master pm
      LEFT JOIN core.product_inventory sm ON pm.product_id = sm.product_id
        AND sm.company_id = $1
        AND sm.branch_id = $2
        AND COALESCE(sm.is_deleted, FALSE) = FALSE
    WHERE
      pm.company_id = $1
      AND COALESCE(pm.is_deleted, FALSE) = FALSE
      AND COALESCE(pm.record_status, 'ACTIVE') = 'ACTIVE'
    ORDER BY
      pm.product_name;
  `;

  const result = await client.query(query, [companyId, branchId]);

  return result.rows.map((row) => ({
    item_id: row.item_id,
    name: row.name,
    sku: row.sku,
    current_stock: Number(row.current_stock),
    minimum_stock: Number(row.minimum_stock),
    reorder_level: Number(row.reorder_level),
    unit: row.unit || 'pcs',
    status: row.status,
  }));
}
