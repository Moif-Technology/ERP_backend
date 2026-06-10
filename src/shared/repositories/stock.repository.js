/**
 * ops.product_log_entry — stock movement on sale.
 * Reduces qty_on_hand on sale (outward log).
 */

export async function nextProductLogId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(product_log_id), 0) + 1 AS n
     FROM ops.product_log_entry WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].n);
}

export async function insertProductLogEntry(client, row) {
  const cols = [
    'company_id', 'branch_id', 'product_log_id', 'product_id',
    'transaction_type', 'transaction_id', 'transaction_date',
    'qty', 'balance_qty', 'unit_cost', 'unit_price',
    'created_at', 'created_by',
  ];
  await client.query(
    `INSERT INTO ops.product_log_entry (${cols.join(',')})
     VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,$8,$9,$10,NOW(),$11)`,
    [
      row.companyId, row.branchId, row.productLogId, row.productId,
      row.transactionType, row.transactionId,
      row.qty, row.balanceQty, row.unitCost, row.unitPrice,
      row.createdBy,
    ],
  );
}

/**
 * Get current stock qty for a product at a branch.
 * Checks stock_balance_entry first, falls back to product_log_entry sum.
 */
export async function getStockQty(client, companyId, branchId, productId) {
  const { rows } = await client.query(
    `SELECT COALESCE(
       (SELECT balance_qty FROM ops.product_log_entry
        WHERE company_id = $1 AND branch_id = $2 AND product_id = $3
        ORDER BY product_log_id DESC LIMIT 1),
       0
     )::numeric AS qty`,
    [companyId, branchId, productId],
  );
  return Number(rows[0].qty);
}
