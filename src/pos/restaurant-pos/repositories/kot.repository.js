/**
 * Data access for ops.kot_master + ops.kot_child (POS KOT).
 */

/** One table name even when the same table_id exists on station + physical branch. */
const TABLE_NAME_JOIN = `
     LEFT JOIN LATERAL (
        SELECT t.table_name
        FROM core.table_master t
        WHERE t.company_id = km.company_id
          AND t.table_id = km.table_id
          AND COALESCE(t.is_deleted, FALSE) = FALSE
          AND t.branch_id IN (km.station_id, km.branch_id)
        ORDER BY CASE WHEN t.branch_id = km.station_id THEN 0 ELSE 1 END
        LIMIT 1
      ) tm ON TRUE
`;

export async function nextKotMasterId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(kot_master_id), 0) + 1 AS n
     FROM ops.kot_master WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].n);
}

export async function nextKotChildId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(kot_child_id), 0) + 1 AS n
     FROM ops.kot_child WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].n);
}

export async function nextKotNumber(client, companyId, stationId, prefix) {
  const p = prefix == null ? '' : String(prefix);
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(kot_number), 0) + 1 AS n
     FROM ops.kot_master
     WHERE company_id = $1 AND station_id = $2 AND COALESCE(kot_prefix, '') = $3`,
    [companyId, stationId, p]
  );
  return Number(rows[0].n);
}

export async function findKotMaster(client, companyId, kotMasterId) {
  const { rows } = await client.query(
    `SELECT kot_master_id, branch_id, station_id, kot_number, kot_prefix, kot_status,
            area_id, table_id, chair_no, customer_id, waiter_id,
            bill_discount, amount, sub_total_m, tax1_amount_m, round_off_adj,
            nof_customer, remarks
     FROM ops.kot_master
     WHERE company_id = $1 AND kot_master_id = $2`,
    [companyId, kotMasterId]
  );
  return rows[0] ?? null;
}

/** Area row for KOT save validations (prefix, supply type, table-creation). */
export async function findArea(client, companyId, stationId, areaId) {
  if (areaId == null || Number(areaId) < 1) return null;
  const { rows } = await client.query(
    `SELECT a.area_id, a.area_name, a.supply_type, a.kot_prefix, a.table_creation_type
     FROM core.area_master a
     LEFT JOIN core.station_master s
       ON s.company_id = a.company_id
      AND s.station_id = $2
      AND s.is_deleted = FALSE
     WHERE a.company_id = $1
       AND a.area_id = $3
       AND a.branch_id IN ($2, s.branch_id)
     ORDER BY CASE WHEN a.branch_id = $2 THEN 0 ELSE 1 END
     LIMIT 1`,
    [companyId, stationId, areaId]
  );
  return rows[0] ?? null;
}

/**
 * VB HasActiveTableChairKOTConflict: another open KOT on the same area/table/chair.
 * excludeKotMasterId = current KOT when updating.
 */
export async function findActiveTableChairConflict(
  client,
  { companyId, stationId, areaId, tableId, chairNo, excludeKotMasterId }
) {
  if (!(areaId > 0) || !(tableId > 0)) return null;
  const params = [companyId, stationId, areaId, tableId, Number(chairNo) || 0];
  let excludeSql = '';
  if (excludeKotMasterId > 0) {
    params.push(excludeKotMasterId);
    excludeSql = ` AND km.kot_master_id <> $${params.length}`;
  }
  const { rows } = await client.query(
    `SELECT km.kot_master_id, km.kot_prefix, km.kot_number, km.waiter_id,
            COALESCE(tm.table_name, '') AS table_name,
            COALESCE(st.staff_name, '') AS waiter_name
     FROM ops.kot_master km
     ${TABLE_NAME_JOIN}
     LEFT JOIN LATERAL (
        SELECT s.staff_name
        FROM core.staff_master s
        WHERE s.company_id = km.company_id
          AND (s.id = km.waiter_id OR s.staff_id = km.waiter_id)
        ORDER BY CASE WHEN s.staff_id = km.waiter_id THEN 0 ELSE 1 END
        LIMIT 1
      ) st ON TRUE
     WHERE km.company_id = $1
       AND km.station_id = $2
       AND km.area_id = $3
       AND km.table_id = $4
       AND COALESCE(km.chair_no, 0) = $5
       AND km.kot_status NOT IN ('CANCELLED','COMPLETED','SUBMIT','SETTLED')
       ${excludeSql}
     ORDER BY km.kot_master_id
     LIMIT 1`,
    params
  );
  return rows[0] ?? null;
}

export async function insertKotMaster(client, row) {
  const {
    companyId,
    branchId,
    stationId,
    kotMasterId,
    kotNumber,
    kotPrefix,
    kotStatus,
    customerId,
    areaId,
    tableId,
    chairNo,
    waiterId,
    billDiscount,
    amount,
    subTotalM,
    tax1AmountM,
    tax2AmountM,
    tax3AmountM,
    tax1RateM,
    tax2RateM,
    tax3RateM,
    roundOffAdj,
    nofCustomer,
    remarks,
    createdBy,
    modifiedBy,
  } = row;
  await client.query(
    `INSERT INTO ops.kot_master (
        company_id, branch_id, kot_master_id, kot_number, kot_prefix, kot_status,
        kot_date, kot_time, customer_id, area_id, table_id, chair_no, waiter_id,
        bill_discount, amount, sub_total_m,
        tax1_amount_m, tax2_amount_m, tax3_amount_m,
        tax1_rate_m, tax2_rate_m, tax3_rate_m,
        round_off_adj, nof_customer, remarks,
        created_by, modified_by, station_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6, NOW(), NOW(), $7,$8,$9,$10,$11,
        $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
      )`,
    [
      companyId,
      branchId,
      kotMasterId,
      kotNumber,
      kotPrefix,
      kotStatus,
      customerId,
      areaId,
      tableId,
      chairNo,
      waiterId,
      billDiscount,
      amount,
      subTotalM,
      tax1AmountM,
      tax2AmountM,
      tax3AmountM,
      tax1RateM,
      tax2RateM,
      tax3RateM,
      roundOffAdj,
      nofCustomer,
      remarks,
      createdBy,
      modifiedBy,
      stationId ?? branchId,
    ]
  );
}

/**
 * VB KOTMaster.Update on append: header fields + totals.
 * Prefix may change when the area changes; kot_number is kept.
 */
export async function updateKotMasterHeader(client, row) {
  const {
    companyId,
    kotMasterId,
    kotPrefix,
    customerId,
    areaId,
    tableId,
    chairNo,
    waiterId,
    billDiscount,
    amount,
    subTotalM,
    tax1AmountM,
    roundOffAdj,
    nofCustomer,
    remarks,
    modifiedBy,
  } = row;
  await client.query(
    `UPDATE ops.kot_master SET
        kot_prefix = COALESCE($3, kot_prefix),
        customer_id = $4,
        area_id = $5,
        table_id = $6,
        chair_no = $7,
        waiter_id = $8,
        bill_discount = $9,
        amount = $10,
        sub_total_m = $11,
        tax1_amount_m = $12,
        round_off_adj = $13,
        nof_customer = $14,
        remarks = $15,
        modified_by = $16,
        modified_on = NOW()
     WHERE company_id = $1 AND kot_master_id = $2`,
    [
      companyId,
      kotMasterId,
      kotPrefix != null ? String(kotPrefix).slice(0, 50) : null,
      customerId,
      areaId,
      tableId,
      chairNo,
      waiterId,
      billDiscount,
      amount,
      subTotalM,
      tax1AmountM,
      roundOffAdj,
      nofCustomer,
      remarks,
      modifiedBy,
    ]
  );
}

export async function updateKotMasterTotals(client, companyId, kotMasterId, modifiedBy) {
  const { rows } = await client.query(
    `SELECT
        COALESCE(SUM(sub_total), 0) AS sub_total,
        COALESCE(SUM(tax_1_amount), 0) AS tax1,
        COALESCE(SUM(line_total), 0) AS total
     FROM ops.kot_child
     WHERE company_id = $1 AND kot_master_id = $2`,
    [companyId, kotMasterId]
  );
  const sub = Number(rows[0].sub_total);
  const tax1 = Number(rows[0].tax1);
  const total = Number(rows[0].total);
  await client.query(
    `UPDATE ops.kot_master SET
        sub_total_m = $3,
        tax1_amount_m = $4,
        amount = $5,
        modified_by = $6,
        modified_on = NOW()
     WHERE company_id = $1 AND kot_master_id = $2`,
    [companyId, kotMasterId, sub, tax1, total, modifiedBy]
  );
  return { subTotalM: sub, tax1AmountM: tax1, amount: total };
}

export async function insertKotChild(client, row) {
  const {
    companyId,
    branchId,
    stationId,
    kotChildId,
    kotMasterId,
    productId,
    barcode,
    shortDescription,
    qty,
    packQty,
    unitCost,
    unitPrice,
    amount,
    itemDiscount,
    subTotal,
    lineTotal,
    tax1Amount,
    tax2Amount,
    tax3Amount,
    tax1Rate,
    tax2Rate,
    tax3Rate,
    groupId,
    modifier,
    kotDisplayStatus,
    createdBy,
    modifiedBy,
  } = row;
  // Legacy DBs often define group_id NOT NULL (default 0); API may pass null when UI omits GroupID.
  const groupIdSafe =
    groupId != null && Number.isFinite(Number(groupId)) ? Math.trunc(Number(groupId)) : 0;
  const barcodeSafe = barcode != null && String(barcode).trim() !== '' ? String(barcode).slice(0, 50) : '';
  await client.query(
    `INSERT INTO ops.kot_child (
        company_id, branch_id, kot_child_id, kot_master_id,
        product_id, barcode, short_description,
        qty, pack_qty, unit_cost, unit_price, amount, item_discount,
        sub_total, line_total,
        tax_1_amount, tax_2_amount, tax_3_amount,
        tax_1_rate, tax_2_rate, tax_3_rate,
        group_id, modifier, kot_display_status,
        created_by, modified_by, station_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
      )`,
    [
      companyId,
      branchId,
      kotChildId,
      kotMasterId,
      productId,
      barcodeSafe,
      shortDescription,
      qty,
      packQty,
      unitCost,
      unitPrice,
      amount,
      itemDiscount,
      subTotal,
      lineTotal,
      tax1Amount,
      tax2Amount,
      tax3Amount,
      tax1Rate,
      tax2Rate,
      tax3Rate,
      groupIdSafe,
      modifier,
      kotDisplayStatus,
      createdBy,
      modifiedBy,
      stationId ?? branchId,
    ]
  );
}

/** VB KOTChild.Update when dgvKOTChildID > 0 on re-save. */
export async function updateKotChild(client, row) {
  const {
    companyId,
    kotChildId,
    kotMasterId,
    productId,
    barcode,
    shortDescription,
    qty,
    packQty,
    unitCost,
    unitPrice,
    amount,
    itemDiscount,
    subTotal,
    lineTotal,
    tax1Amount,
    tax1Rate,
    groupId,
    modifier,
    kotDisplayStatus,
    modifiedBy,
  } = row;
  const groupIdSafe =
    groupId != null && Number.isFinite(Number(groupId)) ? Math.trunc(Number(groupId)) : 0;
  const barcodeSafe = barcode != null && String(barcode).trim() !== '' ? String(barcode).slice(0, 50) : '';
  await client.query(
    `UPDATE ops.kot_child SET
        product_id = $4,
        barcode = $5,
        short_description = $6,
        qty = $7,
        pack_qty = $8,
        unit_cost = $9,
        unit_price = $10,
        amount = $11,
        item_discount = $12,
        sub_total = $13,
        line_total = $14,
        tax_1_amount = $15,
        tax_1_rate = $16,
        group_id = $17,
        modifier = $18,
        kot_display_status = $19,
        modified_by = $20,
        modified_at = NOW()
     WHERE company_id = $1 AND kot_child_id = $2 AND kot_master_id = $3`,
    [
      companyId,
      kotChildId,
      kotMasterId,
      productId,
      barcodeSafe,
      shortDescription,
      qty,
      packQty,
      unitCost,
      unitPrice,
      amount,
      itemDiscount,
      subTotal,
      lineTotal,
      tax1Amount,
      tax1Rate,
      groupIdSafe,
      modifier,
      kotDisplayStatus,
      modifiedBy,
    ]
  );
}

/** Settlement: status, branch, existing bill link (bill_id = sales_id per INDEXES). */
export async function findKotMasterSettlement(client, companyId, kotMasterId) {
  try {
    const { rows } = await client.query(
      `SELECT kot_master_id, branch_id, station_id, kot_status, bill_id
       FROM ops.kot_master
       WHERE company_id = $1 AND kot_master_id = $2`,
      [companyId, kotMasterId]
    );
    return rows[0] ?? null;
  } catch (e) {
    if (e.code === '42703') {
      const { rows } = await client.query(
        `SELECT kot_master_id, branch_id, NULL::bigint AS station_id, kot_status, NULL::bigint AS bill_id
         FROM ops.kot_master
         WHERE company_id = $1 AND kot_master_id = $2`,
        [companyId, kotMasterId]
      );
      return rows[0] ?? null;
    }
    throw e;
  }
}

export async function updateKotMasterSettled(client, companyId, kotMasterId, salesId, modifiedBy) {
  try {
    await client.query(
      `UPDATE ops.kot_master SET
          kot_status = 'SETTLED',
          bill_id = $3,
          modified_by = $4,
          modified_on = NOW()
       WHERE company_id = $1 AND kot_master_id = $2`,
      [companyId, kotMasterId, salesId, modifiedBy]
    );
  } catch (e) {
    if (e.code === '42703') {
      await client.query(
        `UPDATE ops.kot_master SET
            kot_status = 'SETTLED',
            modified_by = $3,
            modified_on = NOW()
         WHERE company_id = $1 AND kot_master_id = $2`,
        [companyId, kotMasterId, modifiedBy]
      );
      return;
    }
    throw e;
  }
}

/**
 * List open (unsettled) KOT headers for the order list.
 * Optional filters: areaId (number), kotNumberSearch (string).
 */
export async function listOpenKots(executor, companyId, stationId, { areaId, kotNumberSearch, supplyType } = {}) {
  const params = [companyId, stationId];
  const clauses = [
    `km.company_id = $1`,
    `km.station_id = $2`,
    `km.kot_status NOT IN ('CANCELLED','COMPLETED','SUBMIT','SETTLED')`,
  ];

  if (areaId != null && Number(areaId) > 0) {
    params.push(Number(areaId));
    clauses.push(`km.area_id = $${params.length}`);
  }
  if (kotNumberSearch != null && String(kotNumberSearch).trim() !== '') {
    params.push(`%${String(kotNumberSearch).trim()}%`);
    const pn = params.length;
    clauses.push(`(km.kot_number::text ILIKE $${pn} OR CONCAT(km.kot_prefix, km.kot_number::text) ILIKE $${pn})`);
  }
  if (supplyType != null && String(supplyType).trim() !== '') {
    const raw = String(supplyType).trim().toUpperCase().replace(/_/g, ' ');
    if (raw === 'TAKEAWAY' || raw === 'TAKE AWAY' || raw === 'PARCEL') {
      clauses.push(
        `REPLACE(UPPER(COALESCE(am.supply_type, '')), '_', ' ') IN ('PARCEL','TAKEAWAY','TAKE AWAY')`,
      );
    } else if (raw === 'DINE IN' || raw === 'DINEIN') {
      clauses.push(`REPLACE(UPPER(COALESCE(am.supply_type, '')), '_', ' ') = 'DINE IN'`);
    } else if (raw === 'DELIVERY') {
      clauses.push(`REPLACE(UPPER(COALESCE(am.supply_type, '')), '_', ' ') = 'DELIVERY'`);
    }
  }

  const { rows } = await executor.query(
    `SELECT
        km.kot_master_id,
        km.kot_number,
        km.kot_prefix,
        km.kot_status,
        km.kot_time,
        km.amount,
        km.bill_discount,
        km.chair_no,
        km.area_id,
        km.table_id,
        km.customer_id,
        km.waiter_id,
        km.nof_customer,
        km.remarks,
        COALESCE(am.area_name, '') AS area_name,
        COALESCE(am.supply_type, '') AS supply_type,
        COALESCE(tm.table_name, '') AS table_name,
        COALESCE(cu.customer_name, '') AS customer_name,
        COALESCE(st.staff_name, '') AS waiter_name
     FROM ops.kot_master km
     LEFT JOIN LATERAL (
        SELECT a.area_name, a.supply_type
        FROM core.area_master a
        WHERE a.company_id = km.company_id
          AND a.area_id = km.area_id
          AND a.branch_id IN (km.station_id, km.branch_id)
        ORDER BY CASE WHEN a.branch_id = km.station_id THEN 0 ELSE 1 END
        LIMIT 1
      ) am ON TRUE
     ${TABLE_NAME_JOIN}
     LEFT JOIN biz.customer_master cu
       ON cu.company_id = km.company_id
      AND cu.customer_id = km.customer_id
     LEFT JOIN LATERAL (
        SELECT s.staff_name
        FROM core.staff_master s
        WHERE s.company_id = km.company_id
          AND (s.id = km.waiter_id OR s.staff_id = km.waiter_id)
        ORDER BY CASE WHEN s.staff_id = km.waiter_id THEN 0 ELSE 1 END
        LIMIT 1
      ) st ON TRUE
     WHERE ${clauses.join(' AND ')}
     ORDER BY km.kot_time DESC NULLS LAST, km.kot_master_id DESC`,
    params
  );
  return rows;
}

export async function listKotDetailRows(executor, companyId, kotMasterId) {
  const { rows } = await executor.query(
    `SELECT
        km.kot_master_id,
        km.kot_number,
        km.kot_prefix,
        km.kot_status,
        km.area_id,
        km.table_id,
        km.chair_no,
        km.customer_id,
        km.waiter_id,
        km.bill_discount,
        km.round_off_adj,
        km.nof_customer,
        km.remarks,
        km.amount,
        km.sub_total_m,
        km.tax1_amount_m,
        am.area_name,
        am.supply_type,
        COALESCE(tm.table_name, '') AS table_name,
        COALESCE(cu.customer_name, '') AS customer_name,
        COALESCE(st.staff_name, '') AS waiter_name,
        kc.kot_child_id,
        kc.product_id,
        kc.short_description,
        kc.qty,
        kc.unit_price,
        kc.unit_cost,
        kc.pack_qty,
        kc.item_discount,
        kc.tax_1_rate,
        kc.tax_1_amount,
        kc.line_total,
        kc.sub_total,
        kc.barcode,
        kc.group_id,
        kc.modifier,
        kc.kot_display_status,
        kc.android_printed
     FROM ops.kot_master km
     LEFT JOIN LATERAL (
        SELECT a.area_name, a.supply_type
        FROM core.area_master a
        WHERE a.company_id = km.company_id
          AND a.area_id = km.area_id
          AND a.branch_id IN (km.station_id, km.branch_id)
        ORDER BY CASE WHEN a.branch_id = km.station_id THEN 0 ELSE 1 END
        LIMIT 1
      ) am ON TRUE
     ${TABLE_NAME_JOIN}
     LEFT JOIN biz.customer_master cu
       ON cu.company_id = km.company_id
      AND cu.customer_id = km.customer_id
     LEFT JOIN LATERAL (
        SELECT s.staff_name
        FROM core.staff_master s
        WHERE s.company_id = km.company_id
          AND (s.id = km.waiter_id OR s.staff_id = km.waiter_id)
        ORDER BY CASE WHEN s.staff_id = km.waiter_id THEN 0 ELSE 1 END
        LIMIT 1
      ) st ON TRUE
     JOIN ops.kot_child kc
       ON kc.company_id = km.company_id
      AND kc.kot_master_id = km.kot_master_id
     WHERE km.company_id = $1 AND km.kot_master_id = $2
     ORDER BY kc.kot_child_id ASC`,
    [companyId, kotMasterId]
  );
  return rows;
}
