/**
 * Reversal / cancel queries for ops.purchase_master and biz.grn_master.
 * Kept apart from purchaseEntry / grn repositories (their SELECT lists change
 * independently).
 */

/** Active purchase returns raised against this purchase. */
export async function countActivePurchaseReturns(conn, companyId, purchaseId) {
  const { rows } = await conn.query(
    `SELECT COUNT(*)::int AS n
     FROM ops.purchase_master
     WHERE company_id = $1 AND source_purchase_id = $2
       AND COALESCE(UPPER(record_status), 'ACTIVE') = 'ACTIVE'
       AND COALESCE(UPPER(post_status), '') <> 'CANCELLED'`,
    [companyId, purchaseId],
  );
  return Number(rows[0]?.n || 0);
}

export async function markPurchaseCancelled(client, companyId, purchaseId, branchId, { reason, actor }) {
  await client.query(
    `UPDATE ops.purchase_master
     SET post_status = 'CANCELLED',
         record_status = 'CANCELLED',
         outstanding_balance = 0,
         remarks = LEFT(CONCAT_WS(' | ', NULLIF(TRIM(remarks), ''), 'CANCELLED: ' || $4), 200),
         modified_by = $5,
         modified_at = NOW()
     WHERE company_id = $1 AND purchase_id = $2 AND branch_id = $3`,
    [companyId, purchaseId, branchId, reason, actor],
  );
}

/** Purchases (not cancelled) that were raised from this GRN. */
export async function listActivePurchasesForGrn(conn, companyId, grnId) {
  const { rows } = await conn.query(
    `SELECT purchase_id, purchase_no
     FROM ops.purchase_master
     WHERE company_id = $1 AND grn_id = $2
       AND COALESCE(UPPER(record_status), 'ACTIVE') = 'ACTIVE'
       AND COALESCE(UPPER(post_status), '') <> 'CANCELLED'`,
    [companyId, grnId],
  );
  return rows;
}

export async function markGrnCancelled(client, companyId, grnId, { reason, actor }) {
  const { rowCount } = await client.query(
    `UPDATE biz.grn_master
     SET post_status = 'CANCELLED',
         remarks = LEFT(CONCAT_WS(' | ', NULLIF(TRIM(remarks), ''), 'CANCELLED: ' || $3), 200),
         mod_by = $4,
         mod_on = NOW()
     WHERE company_id = $1 AND grn_id = $2
       AND UPPER(COALESCE(post_status, '')) <> 'CANCELLED'`,
    [companyId, grnId, reason, actor],
  );
  if (rowCount > 0) {
    await client.query(
      `UPDATE biz.grn_child SET post_status = 'CANCELLED', mod_by = $3, mod_on = NOW()
       WHERE company_id = $1 AND grn_id = $2`,
      [companyId, grnId, actor],
    );
  }
  return rowCount > 0;
}
