/**
 * biz.grn_master / biz.grn_child - goods receipt note.
 * This repository targets the live MOIFONE schema, which keeps legacy audit/status
 * names such as cr_by, r_status_m, unit, and amount.
 */

export async function nextGrnId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(grn_id), 0) + 1 AS n
     FROM biz.grn_master
     WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].n);
}

export async function nextGrnChildId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(grn_child_id), 0) + 1 AS n
     FROM biz.grn_child
     WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].n);
}

export async function listGrnsByBranch(pool, companyId, branchId, limit = 200) {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const { rows } = await pool.query(
    `SELECT grn_id, branch_id, grn_no, grn_date, supplier_id, lpo_master_id,
            supplier_ref_no, invoice_amount, post_status, discount_type,
            discount_amount, round_off_adjustment, transaction_type,
            station_id, remarks, staff_id, purchase_id, purchase_no,
            purchase_status, r_status_m, upload_status_m
     FROM biz.grn_master
     WHERE company_id = $1 AND branch_id = $2
       AND (r_status_m IS NULL OR r_status_m = '' OR r_status_m = 'ACTIVE')
     ORDER BY grn_date DESC NULLS LAST, grn_id DESC
     LIMIT $3`,
    [companyId, branchId, lim],
  );
  return rows;
}

/** @param {import('pg').Pool | import('pg').PoolClient} conn */
export async function getGrnWithLines(conn, companyId, grnId) {
  const { rows: masters } = await conn.query(
    `SELECT *
     FROM biz.grn_master
     WHERE company_id = $1 AND grn_id = $2
     LIMIT 1`,
    [companyId, grnId],
  );
  if (!masters.length) return null;

  const { rows: children } = await conn.query(
    `SELECT *
     FROM biz.grn_child
     WHERE company_id = $1 AND grn_id = $2
     ORDER BY id ASC`,
    [companyId, grnId],
  );
  return { master: masters[0], children };
}

export async function insertGrnMaster(client, row) {
  await client.query(
    `INSERT INTO biz.grn_master (
       grn_id, company_id, branch_id, supplier_id, grn_date, grn_no,
       lpo_master_id, supplier_ref_no, invoice_amount, post_status,
       discount_type, discount_amount, round_off_adjustment, transaction_type,
       station_id, remarks, staff_id, purchase_id, purchase_no, purchase_status,
       cr_by, mod_by, r_status_m, upload_status_m
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
     )`,
    [
      row.grnId,
      row.companyId,
      row.branchId,
      row.supplierId,
      row.grnDate,
      row.grnNo,
      row.lpoMasterId,
      row.supplierRefNo,
      row.invoiceAmount,
      row.postStatus,
      row.discountType,
      row.discountAmount,
      row.roundOffAdjustment,
      row.transactionType,
      row.stationId,
      row.remarks,
      row.staffId,
      row.purchaseId,
      row.purchaseNo,
      row.purchaseStatus,
      row.createdBy,
      row.modifiedBy,
      row.recordStatus,
      row.uploadStatus,
    ],
  );
}

export async function insertGrnChild(client, row) {
  await client.query(
    `INSERT INTO biz.grn_child (
       grn_child_id, grn_id, company_id, branch_id, product_id, unique_product_id,
       pack_qty, qty, unit_cost, last_purchase_cost, unit, foc_qty, foc_amount,
       discount_percentage, discount_amount, amount, station_id, post_status,
       cr_by, mod_by, upload_status_c, r_status_c, lpo_child_id
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
     )`,
    [
      row.grnChildId,
      row.grnId,
      row.companyId,
      row.branchId,
      row.productId,
      row.uniqueProductId,
      row.packQty,
      row.qty,
      row.unitCost,
      row.lastPurchaseCost,
      row.unit,
      row.focQty,
      row.focAmount,
      row.discountPercentage,
      row.discountAmount,
      row.amount,
      row.stationId,
      row.postStatus,
      row.createdBy,
      row.modifiedBy,
      row.uploadStatus,
      row.recordStatus,
      row.lpoChildId,
    ],
  );
}
