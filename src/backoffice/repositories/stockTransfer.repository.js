/**
 * ops.transfer_master / ops.transfer_detail — stock transfer between branches.
 *
 * master.branch_id (and detail.branch_id) = the FROM branch, so the doc number
 * sequence and the (company_id, branch_id, transfer_id) FK stay on one branch.
 * transfer_id / transfer_detail_id are allocated company-wide so a transfer can
 * be fetched by company + transfer_id alone (same as purchase_id).
 */

const MASTER_COLS = `
  tm.transfer_id, tm.branch_id, tm.transfer_no, tm.transfer_date,
  tm.transfer_from_branch_id, tm.transfer_to_branch_id,
  fb.branch_code AS from_branch_code, fb.branch_name AS from_branch_name,
  tb.branch_code AS to_branch_code,   tb.branch_name AS to_branch_name,
  tm.total_amount, tm.remarks, tm.post_status, tm.transfer_status,
  tm.created_at, tm.created_by, tm.modified_at, tm.modified_by,
  tm.posted_at, tm.posted_by, tm.cancelled_at, tm.cancelled_by, tm.cancel_reason`;

const MASTER_FROM = `
  FROM ops.transfer_master tm
  LEFT JOIN core.branch_master fb
    ON fb.company_id = tm.company_id AND fb.branch_id = tm.transfer_from_branch_id
  LEFT JOIN core.branch_master tb
    ON tb.company_id = tm.company_id AND tb.branch_id = tm.transfer_to_branch_id`;

export async function nextTransferId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(transfer_id), 0) + 1 AS n
     FROM ops.transfer_master WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].n);
}

export async function nextTransferDetailId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(transfer_detail_id), 0) + 1 AS n
     FROM ops.transfer_detail WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].n);
}

export async function insertMaster(client, row) {
  await client.query(
    `INSERT INTO ops.transfer_master (
       company_id, branch_id, transfer_id, transfer_no,
       transfer_from_branch_id, transfer_to_branch_id, transfer_date,
       total_amount, remarks, post_status, transfer_status, record_status,
       created_by, modified_by, modified_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT','OPEN','A',$10,$10,NOW())`,
    [
      row.companyId, row.fromBranchId, row.transferId, row.transferNo,
      row.fromBranchId, row.toBranchId, row.transferDate,
      row.totalAmount, row.remarks, row.actor,
    ],
  );
}

/** Draft-only update. from branch is fixed after create (it owns the doc number). */
export async function updateDraftMaster(client, row) {
  const { rowCount } = await client.query(
    `UPDATE ops.transfer_master
     SET transfer_to_branch_id = $3, transfer_date = $4, total_amount = $5,
         remarks = $6, modified_by = $7, modified_at = NOW()
     WHERE company_id = $1 AND transfer_id = $2 AND post_status = 'DRAFT'`,
    [row.companyId, row.transferId, row.toBranchId, row.transferDate, row.totalAmount, row.remarks, row.actor],
  );
  return rowCount > 0;
}

export async function deleteDetails(client, companyId, branchId, transferId) {
  await client.query(
    `DELETE FROM ops.transfer_detail
     WHERE company_id = $1 AND branch_id = $2 AND transfer_id = $3`,
    [companyId, branchId, transferId],
  );
}

export async function insertDetail(client, row) {
  await client.query(
    `INSERT INTO ops.transfer_detail (
       company_id, branch_id, transfer_detail_id, transfer_id, product_id,
       qty, pack_qty, average_cost, unit_price, line_total, line_notes,
       post_status, record_status, created_by, modified_by, modified_at
     ) VALUES ($1,$2,$3,$4,$5,$6,1,$7,0,$8,$9,'DRAFT','A',$10,$10,NOW())`,
    [
      row.companyId, row.branchId, row.transferDetailId, row.transferId, row.productId,
      row.qty, row.averageCost, row.lineTotal, row.lineNotes, row.actor,
    ],
  );
}

export async function getMaster(conn, companyId, transferId, { forUpdate = false } = {}) {
  if (forUpdate) {
    await conn.query(
      `SELECT 1 FROM ops.transfer_master WHERE company_id = $1 AND transfer_id = $2 FOR UPDATE`,
      [companyId, transferId],
    );
  }
  const { rows } = await conn.query(
    `SELECT ${MASTER_COLS} ${MASTER_FROM}
     WHERE tm.company_id = $1 AND tm.transfer_id = $2
     LIMIT 1`,
    [companyId, transferId],
  );
  return rows[0] || null;
}

export async function getDetails(conn, companyId, branchId, transferId) {
  const { rows } = await conn.query(
    `SELECT td.transfer_detail_id, td.product_id, td.qty, td.average_cost,
            td.line_total, td.line_notes,
            pm.product_code, pm.barcode, pm.product_name, pm.unit_name
     FROM ops.transfer_detail td
     LEFT JOIN core.product_master pm
       ON pm.company_id = td.company_id AND pm.product_id = td.product_id
     WHERE td.company_id = $1 AND td.branch_id = $2 AND td.transfer_id = $3
     ORDER BY td.transfer_detail_id ASC`,
    [companyId, branchId, transferId],
  );
  return rows;
}

/** Transfers where the branch is the source or destination (or all when branchId is null). */
export async function listMasters(conn, companyId, { branchId = null, status = null, limit = 200 } = {}) {
  const params = [companyId];
  let where = 'WHERE tm.company_id = $1';
  if (branchId) {
    params.push(branchId);
    where += ` AND (tm.transfer_from_branch_id = $${params.length} OR tm.transfer_to_branch_id = $${params.length})`;
  }
  if (status) {
    params.push(status);
    where += ` AND tm.post_status = $${params.length}`;
  }
  params.push(Math.min(Math.max(Number(limit) || 200, 1), 1000));
  const { rows } = await conn.query(
    `SELECT ${MASTER_COLS},
            (SELECT COUNT(*)::int FROM ops.transfer_detail td
              WHERE td.company_id = tm.company_id AND td.branch_id = tm.branch_id
                AND td.transfer_id = tm.transfer_id) AS line_count
     ${MASTER_FROM}
     ${where}
     ORDER BY tm.transfer_date DESC, tm.transfer_id DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

export async function setPosted(client, companyId, branchId, transferId, totalAmount, actor) {
  await client.query(
    `UPDATE ops.transfer_master
     SET post_status = 'POSTED', transfer_status = 'RECEIVED', total_amount = $4,
         posted_at = NOW(), posted_by = $5, modified_at = NOW(), modified_by = $5
     WHERE company_id = $1 AND branch_id = $2 AND transfer_id = $3`,
    [companyId, branchId, transferId, totalAmount, actor],
  );
  await client.query(
    `UPDATE ops.transfer_detail SET post_status = 'POSTED', modified_at = NOW(), modified_by = $4
     WHERE company_id = $1 AND branch_id = $2 AND transfer_id = $3`,
    [companyId, branchId, transferId, actor],
  );
}

export async function setDetailCost(client, companyId, branchId, transferDetailId, averageCost, lineTotal) {
  await client.query(
    `UPDATE ops.transfer_detail SET average_cost = $4, line_total = $5
     WHERE company_id = $1 AND branch_id = $2 AND transfer_detail_id = $3`,
    [companyId, branchId, transferDetailId, averageCost, lineTotal],
  );
}

export async function setCancelled(client, companyId, branchId, transferId, reason, actor) {
  await client.query(
    `UPDATE ops.transfer_master
     SET post_status = 'CANCELLED', transfer_status = 'CANCELLED',
         cancelled_at = NOW(), cancelled_by = $5, cancel_reason = $4,
         modified_at = NOW(), modified_by = $5
     WHERE company_id = $1 AND branch_id = $2 AND transfer_id = $3`,
    [companyId, branchId, transferId, reason, actor],
  );
  await client.query(
    `UPDATE ops.transfer_detail SET post_status = 'CANCELLED', modified_at = NOW(), modified_by = $4
     WHERE company_id = $1 AND branch_id = $2 AND transfer_id = $3`,
    [companyId, branchId, transferId, actor],
  );
}

/** Inventory row for cost / availability. Locks it when called inside a posting transaction. */
export async function getInventoryRow(conn, companyId, branchId, productId, { forUpdate = false } = {}) {
  const { rows } = await conn.query(
    `SELECT qty_on_hand, average_cost, last_purchase_cost, unit_price
     FROM core.product_inventory
     WHERE company_id = $1 AND branch_id = $2 AND product_id = $3
     LIMIT 1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [companyId, branchId, productId],
  );
  return rows[0] || null;
}

/**
 * Destination branch may not stock the product yet. Copy the source row's
 * pricing (qty 0) so applyStockMovement has a qty_on_hand to add to.
 */
export async function ensureInventoryRow(client, companyId, sourceBranchId, targetBranchId, productId, actor) {
  await client.query(
    `INSERT INTO core.product_inventory (
       company_id, branch_id, product_inventory_id, product_id,
       pack_qty, qty_on_hand, reorder_level, reorder_qty, correction_factor,
       last_purchase_cost, average_cost, unit_price,
       minimum_retail_price, maximum_retail_price,
       price_level_1, price_level_2, price_level_3, price_level_4, price_level_5,
       margin_amount, minimum_margin_percentage, discount_percentage,
       input_tax_1_rate, output_tax_1_rate,
       record_status, created_by, modified_by
     )
     SELECT src.company_id, $3,
            (SELECT COALESCE(MAX(product_inventory_id), 0) + 1
               FROM core.product_inventory WHERE company_id = $1),
            src.product_id,
            src.pack_qty, 0, 0, 0, src.correction_factor,
            src.last_purchase_cost, src.average_cost, src.unit_price,
            src.minimum_retail_price, src.maximum_retail_price,
            src.price_level_1, src.price_level_2, src.price_level_3, src.price_level_4, src.price_level_5,
            src.margin_amount, src.minimum_margin_percentage, src.discount_percentage,
            src.input_tax_1_rate, src.output_tax_1_rate,
            'ACTIVE', $5, $5
     FROM core.product_inventory src
     WHERE src.company_id = $1 AND src.branch_id = $2 AND src.product_id = $4
     ON CONFLICT (company_id, branch_id, product_id) DO NOTHING`,
    [companyId, sourceBranchId, targetBranchId, productId, actor],
  );
}

/**
 * Weighted average cost at the receiving branch. Unlike
 * stock.repository.updateCostsOnPurchase it leaves last_purchase_cost alone —
 * a transfer is not a purchase. Run BEFORE the qty_on_hand increment.
 */
export async function updateAverageCostOnReceive(client, companyId, branchId, productId, qty, unitCost) {
  await client.query(
    `UPDATE core.product_inventory
     SET average_cost = CASE
           WHEN GREATEST(COALESCE(qty_on_hand, 0), 0) + $4 > 0 THEN
             ROUND((
               (GREATEST(COALESCE(qty_on_hand, 0), 0) * COALESCE(NULLIF(average_cost, 0), $5))
               + ($4 * $5)
             ) / (GREATEST(COALESCE(qty_on_hand, 0), 0) + $4), 2)
           ELSE average_cost
         END,
         modified_at = NOW()
     WHERE company_id = $1 AND branch_id = $2 AND product_id = $3`,
    [companyId, branchId, productId, qty, unitCost],
  );
}
