/** Repository for ops.stock_entry_master / detail and related queries. */

export async function nextEntryId(client, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(entry_id), 0) + 1 AS n
     FROM ops.stock_entry_master WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId],
  );
  return Number(rows[0].n);
}

export async function generateEntryNo(client, companyId, branchId, docType) {
  const prefix = { ADJ: 'SA', DMG: 'DM', ASE: 'AS' }[docType] ?? 'SE';
  const { rows } = await client.query(
    `SELECT COUNT(*) AS cnt FROM ops.stock_entry_master
     WHERE company_id = $1 AND branch_id = $2 AND doc_type = $3`,
    [companyId, branchId, docType],
  );
  const n = Number(rows[0].cnt) + 1;
  const yr = new Date().getFullYear();
  return `${prefix}-${yr}-${String(n).padStart(5, '0')}`;
}

export async function insertMaster(client, row) {
  await client.query(
    `INSERT INTO ops.stock_entry_master
     (company_id, branch_id, entry_id, entry_no, doc_type, entry_date, remark, post_status, created_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',NOW(),$8)`,
    [row.companyId, row.branchId, row.entryId, row.entryNo, row.docType,
     row.entryDate, row.remark, row.createdBy],
  );
}

export async function updateMaster(client, row) {
  const { rowCount } = await client.query(
    `UPDATE ops.stock_entry_master
     SET entry_no=$4, entry_date=$5, remark=$6
     WHERE company_id=$1 AND branch_id=$2 AND entry_id=$3 AND post_status='draft'`,
    [row.companyId, row.branchId, row.entryId, row.entryNo, row.entryDate, row.remark],
  );
  return rowCount;
}

export async function deleteDetailLines(client, companyId, branchId, entryId) {
  await client.query(
    `DELETE FROM ops.stock_entry_detail WHERE company_id=$1 AND branch_id=$2 AND entry_id=$3`,
    [companyId, branchId, entryId],
  );
}

export async function insertDetailLine(client, row) {
  await client.query(
    `INSERT INTO ops.stock_entry_detail
     (company_id, branch_id, entry_id, line_id, product_id, barcode, short_description,
      pkt_qty, pkt_details, system_qty, adj_qty, entered_qty, physical_qty, reason, line_total)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      row.companyId, row.branchId, row.entryId, row.lineId,
      row.productId ?? null, row.barcode ?? null, row.shortDescription ?? null,
      row.pktQty ?? null, row.pktDetails ?? null, row.systemQty ?? null,
      row.adjQty ?? null, row.enteredQty ?? null, row.physicalQty ?? null,
      row.reason ?? null, row.lineTotal ?? null,
    ],
  );
}

export async function getMaster(client, companyId, branchId, entryId) {
  const { rows } = await client.query(
    `SELECT * FROM ops.stock_entry_master
     WHERE company_id=$1 AND branch_id=$2 AND entry_id=$3`,
    [companyId, branchId, entryId],
  );
  return rows[0] ?? null;
}

export async function getDetail(client, companyId, branchId, entryId) {
  const { rows } = await client.query(
    `SELECT * FROM ops.stock_entry_detail
     WHERE company_id=$1 AND branch_id=$2 AND entry_id=$3
     ORDER BY line_id`,
    [companyId, branchId, entryId],
  );
  return rows;
}

export async function listMasters(client, companyId, branchId, docType) {
  const { rows } = await client.query(
    `SELECT entry_id, entry_no, doc_type, entry_date, remark, post_status, created_at
     FROM ops.stock_entry_master
     WHERE company_id=$1 AND branch_id=$2 AND doc_type=$3
     ORDER BY entry_id DESC`,
    [companyId, branchId, docType],
  );
  return rows;
}

export async function postEntry(client, companyId, branchId, entryId, staffId) {
  const { rowCount } = await client.query(
    `UPDATE ops.stock_entry_master
     SET post_status='posted', posted_at=NOW(), posted_by=$4
     WHERE company_id=$1 AND branch_id=$2 AND entry_id=$3 AND post_status='draft'`,
    [companyId, branchId, entryId, staffId],
  );
  return rowCount;
}

export async function unpostEntry(client, companyId, branchId, entryId) {
  const { rowCount } = await client.query(
    `UPDATE ops.stock_entry_master
     SET post_status='draft', posted_at=NULL, posted_by=NULL
     WHERE company_id=$1 AND branch_id=$2 AND entry_id=$3 AND post_status='posted'`,
    [companyId, branchId, entryId],
  );
  return rowCount;
}

export async function deleteMasterAndDetail(client, companyId, branchId, entryId) {
  // detail rows cascade via FK; explicit delete is fine too
  await client.query(
    `DELETE FROM ops.stock_entry_detail WHERE company_id=$1 AND branch_id=$2 AND entry_id=$3`,
    [companyId, branchId, entryId],
  );
  await client.query(
    `DELETE FROM ops.stock_entry_master WHERE company_id=$1 AND branch_id=$2 AND entry_id=$3`,
    [companyId, branchId, entryId],
  );
}

export async function getReorderList(client, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT
       pm.product_id,
       pm.barcode,
       pm.product_name AS short_description,
       COALESCE(pi.qty_on_hand, 0)          AS qty_on_hand,
       COALESCE(pi.reorder_level, 0)        AS reorder_level,
       COALESCE(pi.reorder_qty, 0)          AS reorder_qty,
       COALESCE(pi.last_purchase_cost, 0)   AS unit_cost,
       pi.product_inventory_id
     FROM core.product_inventory pi
     JOIN core.product_master pm
       ON pm.company_id = pi.company_id AND pm.product_id = pi.product_id
     WHERE pi.company_id = $1
       AND pi.branch_id  = $2
       AND pi.qty_on_hand <= pi.reorder_level
     ORDER BY pm.product_name`,
    [companyId, branchId],
  );
  return rows;
}

export async function getDraftEnteredQty(client, companyId, branchId, productId) {
  const { rows } = await client.query(
    `SELECT d.physical_qty
     FROM ops.stock_entry_detail d
     JOIN ops.stock_entry_master m
       ON m.company_id = d.company_id
      AND m.branch_id = d.branch_id
      AND m.entry_id = d.entry_id
     WHERE d.company_id = $1
       AND d.branch_id = $2
       AND d.product_id = $3
       AND m.post_status = 'draft'
     ORDER BY d.entry_id DESC, d.line_id DESC
     LIMIT 1`,
    [companyId, branchId, productId],
  );
  return rows[0] ?? null;
}

export async function getProductMovement(client, companyId, branchId, params) {
  const conds = ['pl.company_id = $1', 'pl.branch_id = $2'];
  const vals = [companyId, branchId];
  let i = 3;

  if (params.productId) { conds.push(`pl.product_id = $${i++}`); vals.push(params.productId); }
  if (params.barcode) {
    conds.push(`pm.barcode ILIKE $${i++}`);
    vals.push(`%${params.barcode}%`);
  }
  if (params.fromDate) { conds.push(`pl.transaction_date >= $${i++}`); vals.push(params.fromDate); }
  if (params.toDate)   { conds.push(`pl.transaction_date <= $${i++}`); vals.push(params.toDate); }
  if (params.group) {
    conds.push(`(
      gm.group_code ILIKE $${i}
      OR gm.group_description ILIKE $${i}
      OR CAST(pm.group_id AS text) ILIKE $${i}
    )`);
    vals.push(`%${params.group}%`);
    i += 1;
  }
  if (params.subGroup) {
    conds.push(`(
      sgm.sub_group_code ILIKE $${i}
      OR sgm.sub_group_description ILIKE $${i}
      OR CAST(pm.subgroup_id AS text) ILIKE $${i}
    )`);
    vals.push(`%${params.subGroup}%`);
    i += 1;
  }
  if (params.subSubGroup) {
    conds.push(`CAST(pm.subsubgroup_id AS text) ILIKE $${i++}`);
    vals.push(`%${params.subSubGroup}%`);
  }
  if (params.unit) {
    conds.push(`pm.unit_name ILIKE $${i++}`);
    vals.push(`%${params.unit}%`);
  }
  if (params.location) {
    conds.push(`pi.location_code ILIKE $${i++}`);
    vals.push(`%${params.location}%`);
  }
  if (params.packetDescription) {
    conds.push(`pm.pack_description ILIKE $${i++}`);
    vals.push(`%${params.packetDescription}%`);
  }

  const { rows } = await client.query(
    `SELECT
       pl.product_log_id,
       TO_CHAR(pl.transaction_date, 'DD/MM/YYYY') AS date,
       pl.transaction_type   AS trans_type,
       pl.transaction_id     AS doc_id,
       COALESCE(
         CASE
           WHEN pl.transaction_type IN ('ADJ','DMG','ASE')
           THEN (SELECT sem.entry_no FROM ops.stock_entry_master sem
                 WHERE sem.company_id = pl.company_id
                   AND sem.branch_id  = pl.branch_id
                   AND sem.entry_id   = pl.transaction_id
                 LIMIT 1)
           ELSE pl.transaction_id::text
         END,
         pl.transaction_id::text
       )                     AS doc_no,
       pl.qty                AS quantity,
       LAG(pl.balance_qty, 1, pl.balance_qty - pl.qty)
         OVER (PARTITION BY pl.company_id, pl.branch_id, pl.product_id
               ORDER BY pl.product_log_id) AS opening_stock,
       pl.balance_qty        AS balance,
       pm.product_name,
       pm.barcode
     FROM ops.product_log_entry pl
     LEFT JOIN core.product_master pm
       ON pm.company_id = pl.company_id AND pm.product_id = pl.product_id
     LEFT JOIN core.product_inventory pi
       ON pi.company_id = pl.company_id
      AND pi.branch_id = pl.branch_id
      AND pi.product_id = pl.product_id
     LEFT JOIN biz.group_master gm
       ON gm.company_id = pm.company_id
      AND gm.branch_id = pl.branch_id
      AND gm.group_id = pm.group_id
     LEFT JOIN biz.sub_group_master sgm
       ON sgm.company_id = pm.company_id
      AND sgm.branch_id = pl.branch_id
      AND sgm.sub_group_id = pm.subgroup_id
     WHERE ${conds.join(' AND ')}
     ORDER BY pl.product_log_id ASC`,
    vals,
  );
  return rows;
}

export async function nextProductLogId(client, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(product_log_id), 0) + 1 AS n
     FROM ops.product_log_entry WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId],
  );
  return Number(rows[0].n);
}

export async function getInventory(client, companyId, branchId, productId) {
  const { rows } = await client.query(
    `SELECT qty_on_hand, last_purchase_cost AS unit_cost, unit_price
     FROM core.product_inventory
     WHERE company_id=$1 AND branch_id=$2 AND product_id=$3`,
    [companyId, branchId, productId],
  );
  return rows[0] ?? null;
}

export async function adjustInventoryQty(client, companyId, branchId, productId, delta) {
  await client.query(
    `UPDATE core.product_inventory
     SET qty_on_hand = qty_on_hand + $4
     WHERE company_id=$1 AND branch_id=$2 AND product_id=$3`,
    [companyId, branchId, productId, delta],
  );
}

export async function insertProductLog(client, row) {
  await client.query(
    `INSERT INTO ops.product_log_entry
     (company_id, branch_id, product_log_id, product_id, transaction_type,
      transaction_id, transaction_date, qty, balance_qty, unit_cost, unit_price,
      created_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE,$7,$8,$9,$10,NOW(),$11)`,
    [
      row.companyId, row.branchId, row.logId, row.productId,
      row.transactionType, row.transactionId,
      row.qty, row.balanceQty, row.unitCost, row.unitPrice, row.createdBy,
    ],
  );
}

export async function deleteProductLogsByEntry(client, companyId, branchId, entryId, transType) {
  await client.query(
    `DELETE FROM ops.product_log_entry
     WHERE company_id=$1 AND branch_id=$2 AND transaction_id=$3 AND transaction_type=$4`,
    [companyId, branchId, entryId, transType],
  );
}
