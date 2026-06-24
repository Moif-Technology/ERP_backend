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
 * Keep core.product_inventory.qty_on_hand in step with product_log_entry.
 * delta is signed: negative on sale, positive on purchase/return.
 * No-op (returns 0) when the product has no inventory row at this branch.
 */
export async function adjustQtyOnHand(client, companyId, branchId, productId, delta) {
  const { rowCount } = await client.query(
    `UPDATE core.product_inventory
     SET qty_on_hand = COALESCE(qty_on_hand, 0) + $4,
         modified_at = NOW()
     WHERE company_id = $1 AND branch_id = $2 AND product_id = $3`,
    [companyId, branchId, productId, delta],
  );
  return rowCount;
}

/**
 * One stock movement = product_log_entry row + qty_on_hand sync.
 * Reads the current balance from the log so balance_qty stays a running total.
 */
export async function applyStockMovement(client, {
  companyId, branchId, productId,
  transactionType, transactionId,
  qty, // signed: negative = outward (sale), positive = inward (purchase)
  unitCost, unitPrice, createdBy,
}) {
  const currentQty = await getStockQty(client, companyId, branchId, productId);
  const balanceQty = Math.round((currentQty + qty) * 100) / 100;
  const productLogId = await nextProductLogId(client, companyId);
  await insertProductLogEntry(client, {
    companyId, branchId, productLogId, productId,
    transactionType, transactionId,
    qty, balanceQty, unitCost, unitPrice, createdBy,
  });
  await adjustQtyOnHand(client, companyId, branchId, productId, qty);
  return balanceQty;
}

/**
 * Purchase cost roll-up: last_purchase_cost + weighted average_cost.
 * Must run BEFORE the qty_on_hand increment so the average uses the
 * pre-purchase on-hand quantity.
 */
export async function updateCostsOnPurchase(client, companyId, branchId, productId, qty, unitCost) {
  await client.query(
    `UPDATE core.product_inventory
     SET last_purchase_cost = $5,
         average_cost = CASE
           WHEN GREATEST(COALESCE(qty_on_hand, 0), 0) + $4 > 0 THEN
             ROUND((
               (GREATEST(COALESCE(qty_on_hand, 0), 0) * COALESCE(average_cost, last_purchase_cost, $5))
               + ($4 * $5)
             ) / (GREATEST(COALESCE(qty_on_hand, 0), 0) + $4), 4)
           ELSE $5
         END,
         modified_at = NOW()
     WHERE company_id = $1 AND branch_id = $2 AND product_id = $3`,
    [companyId, branchId, productId, qty, unitCost],
  );
}

/**
 * Get current stock qty for a product at a branch.
 * Uses product_inventory.qty_on_hand (same as sales UI / privilege checks),
 * falling back to the latest product_log_entry balance when no inventory row exists.
 */
export async function getStockQty(client, companyId, branchId, productId) {
  const { rows } = await client.query(
    `SELECT qty_on_hand
     FROM core.product_inventory
     WHERE company_id = $1 AND branch_id = $2 AND product_id = $3
     LIMIT 1`,
    [companyId, branchId, productId],
  );
  if (rows[0] && rows[0].qty_on_hand != null) {
    return Number(rows[0].qty_on_hand) || 0;
  }
  const { rows: logRows } = await client.query(
    `SELECT COALESCE(
       (SELECT balance_qty FROM ops.product_log_entry
        WHERE company_id = $1 AND branch_id = $2 AND product_id = $3
        ORDER BY product_log_id DESC LIMIT 1),
       0
     )::numeric AS qty`,
    [companyId, branchId, productId],
  );
  return Number(logRows[0]?.qty) || 0;
}
