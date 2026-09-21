/**
 * Data access for ops.kot_master + ops.kot_child (POS KOT).
 */

/** One table name even when the same table_id exists on station + physical branch. */
const TABLE_NAME_JOIN = `
     LEFT JOIN LATERAL (
        SELECT t.table_name, t.table_no
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
            bill_discount, amount, sub_total_m, tax1_amount_m, tax1_rate_m, round_off_adj,
            nof_customer, remarks, discount_type
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

/** Table row for Area Change transfer (station/branch scoped like findArea). */
export async function findTable(client, companyId, stationId, tableId) {
  if (tableId == null || Number(tableId) < 1) return null;
  const { rows } = await client.query(
    `SELECT t.table_id, t.table_name, t.table_no, t.area_id, t.no_of_chairs, t.table_format
     FROM core.table_master t
     LEFT JOIN core.station_master s
       ON s.company_id = t.company_id
      AND s.station_id = $2
      AND s.is_deleted = FALSE
     WHERE t.company_id = $1
       AND t.table_id = $3
       AND COALESCE(t.is_deleted, FALSE) = FALSE
       AND t.branch_id IN ($2, s.branch_id)
     ORDER BY CASE WHEN t.branch_id = $2 THEN 0 ELSE 1 END
     LIMIT 1`,
    [companyId, stationId, tableId]
  );
  return rows[0] ?? null;
}

/**
 * TableFloorRuntimeFrmAreaChange LoadTables occupancy:
 * KOTStatus NOT IN ('CANCELLED','COMPLETED') on this table (any chair).
 */
export async function findActiveKotOnTable(
  client,
  companyId,
  stationId,
  tableId,
  excludeKotMasterId = 0,
) {
  if (!(tableId > 0)) return null;
  const params = [companyId, stationId, tableId];
  let excludeSql = '';
  if (excludeKotMasterId > 0) {
    params.push(excludeKotMasterId);
    excludeSql = ` AND km.kot_master_id <> $${params.length}`;
  }
  const { rows } = await client.query(
    `SELECT km.kot_master_id, km.kot_prefix, km.kot_number, km.area_id, km.table_id, km.kot_status
     FROM ops.kot_master km
     WHERE km.company_id = $1
       AND km.station_id = $2
       AND km.table_id = $3
       AND UPPER(COALESCE(km.kot_status, '')) NOT IN ('CANCELLED','COMPLETED')
       ${excludeSql}
     ORDER BY km.kot_master_id
     LIMIT 1`,
    params
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
    discountType,
  } = row;
  const discType = Number(discountType) === 2 ? 2 : 0;
  await client.query(
    `INSERT INTO ops.kot_master (
        company_id, branch_id, kot_master_id, kot_number, kot_prefix, kot_status,
        kot_date, kot_time, customer_id, area_id, table_id, chair_no, waiter_id,
        bill_discount, amount, sub_total_m,
        tax1_amount_m, tax2_amount_m, tax3_amount_m,
        tax1_rate_m, tax2_rate_m, tax3_rate_m,
        round_off_adj, nof_customer, remarks,
        created_by, modified_by, station_id, discount_type
      ) VALUES (
        $1,$2,$3,$4,$5,$6, NOW(), NOW(), $7,$8,$9,$10,$11,
        $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
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
      discType,
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
    tax1RateM,
    roundOffAdj,
    nofCustomer,
    remarks,
    modifiedBy,
    discountType,
  } = row;
  const discType = Number(discountType) === 2 ? 2 : 0;
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
        tax1_rate_m = COALESCE($13, tax1_rate_m),
        round_off_adj = $14,
        nof_customer = $15,
        remarks = $16,
        modified_by = $17,
        discount_type = $18,
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
      tax1RateM != null && Number.isFinite(Number(tax1RateM)) ? Number(tax1RateM) : null,
      roundOffAdj,
      nofCustomer,
      remarks,
      modifiedBy,
      discType,
    ]
  );
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Mainfrm.CalcTotal after child sums:
 *   no bill disc → tax/amount from lines
 *   bill disc → tax from (taxable subtotal − disc) * Tax1%
 */
export async function updateKotMasterTotals(client, companyId, kotMasterId, modifiedBy, tax1RateOverride = null) {
  const { rows } = await client.query(
    `SELECT
        COALESCE(SUM(sub_total), 0) AS sub_total,
        COALESCE(SUM(tax_1_amount), 0) AS tax1,
        COALESCE(SUM(line_total), 0) AS total,
        COALESCE(SUM(CASE WHEN COALESCE(tax_1_rate, 0) > 0 THEN sub_total ELSE 0 END), 0) AS taxable_sub,
        COALESCE(SUM(CASE WHEN COALESCE(tax_1_rate, 0) <= 0 THEN sub_total ELSE 0 END), 0) AS nontaxable_sub
     FROM ops.kot_child
     WHERE company_id = $1 AND kot_master_id = $2`,
    [companyId, kotMasterId]
  );
  const master = await findKotMaster(client, companyId, kotMasterId);
  const sub = Number(rows[0].sub_total);
  const lineTax = Number(rows[0].tax1);
  const taxableSub = Number(rows[0].taxable_sub);
  const nontaxableSub = Number(rows[0].nontaxable_sub);
  const disc = Number(master?.bill_discount ?? 0);
  const roundOff = Number(master?.round_off_adj ?? 0);
  const taxPct = Number(
    tax1RateOverride != null && tax1RateOverride !== ''
      ? tax1RateOverride
      : master?.tax1_rate_m ?? 0,
  );

  let tax1 = lineTax;
  let amount;
  if (disc > 0) {
    if (taxableSub > 0) {
      const discountAmt = disc > taxableSub ? taxableSub : disc;
      const discountedTaxable = roundMoney(taxableSub - discountAmt);
      tax1 = roundMoney(discountedTaxable * (taxPct / 100));
      amount = roundMoney(discountedTaxable + tax1 + nontaxableSub + roundOff);
    } else {
      tax1 = 0;
      amount = roundMoney(sub - disc + roundOff);
    }
  } else {
    amount = roundMoney(sub + tax1 + roundOff);
  }

  await client.query(
    `UPDATE ops.kot_master SET
        sub_total_m = $3,
        tax1_amount_m = $4,
        amount = $5,
        tax1_rate_m = COALESCE($6, tax1_rate_m),
        modified_by = $7,
        modified_on = NOW()
     WHERE company_id = $1 AND kot_master_id = $2`,
    [
      companyId,
      kotMasterId,
      sub,
      tax1,
      amount,
      Number.isFinite(taxPct) ? taxPct : null,
      modifiedBy,
    ]
  );
  return { subTotalM: sub, tax1AmountM: tax1, amount };
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
  const modBy =
    modifiedBy != null && Number.isFinite(Number(modifiedBy)) ? Math.trunc(Number(modifiedBy)) : null;
  try {
    await client.query(
      `UPDATE ops.kot_master SET
          kot_status = 'SETTLED',
          bill_id = $3,
          modified_by = $4,
          modified_on = NOW()
       WHERE company_id = $1 AND kot_master_id = $2`,
      [companyId, kotMasterId, salesId, modBy]
    );
  } catch (e) {
    if (e.code === '42703') {
      await client.query(
        `UPDATE ops.kot_master SET
            kot_status = 'SETTLED',
            modified_by = $3,
            modified_on = NOW()
         WHERE company_id = $1 AND kot_master_id = $2`,
        [companyId, kotMasterId, modBy]
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
export async function listOpenKots(
  executor,
  companyId,
  stationId,
  { areaId, kotNumberSearch, supplyType, joinList, kotExact } = {},
) {
  const params = [companyId, stationId];
  const forJoin = joinList === true || joinList === 1 || joinList === '1' || joinList === 'true';
  const exactKot =
    kotExact === true || kotExact === 1 || kotExact === '1' || kotExact === 'true' || forJoin;
  const clauses = [
    `km.company_id = $1`,
    `km.station_id = $2`,
    forJoin
      ? `UPPER(COALESCE(km.kot_status, '')) NOT IN ('CANCELLED','COMPLETED')`
      : `km.kot_status NOT IN ('CANCELLED','COMPLETED','SUBMIT','SETTLED')`,
  ];

  if (areaId != null && Number(areaId) > 0) {
    params.push(Number(areaId));
    clauses.push(`km.area_id = $${params.length}`);
  }
  if (kotNumberSearch != null && String(kotNumberSearch).trim() !== '') {
    const term = String(kotNumberSearch).trim();
    if (exactKot) {
      params.push(term.toUpperCase());
      const pn = params.length;
      clauses.push(
        `UPPER(TRIM(BOTH FROM COALESCE(km.kot_prefix, '')) || km.kot_number::text) = $${pn}`,
      );
    } else {
      params.push(`%${term}%`);
      const pn = params.length;
      clauses.push(`(km.kot_number::text ILIKE $${pn} OR CONCAT(km.kot_prefix, km.kot_number::text) ILIKE $${pn})`);
    }
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
        COALESCE(tm.table_no, 0) AS table_no,
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
     ORDER BY ${
       forJoin
         ? 'km.kot_master_id ASC'
         : 'km.kot_time DESC NULLS LAST, km.kot_master_id DESC'
     }`,
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
        km.discount_type,
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

export async function listKotChildren(executor, companyId, kotMasterId) {
  const { rows } = await executor.query(
    `SELECT kot_child_id, product_id, barcode, short_description, qty, pack_qty,
            unit_cost, unit_price, amount, item_discount, sub_total, line_total,
            tax_1_amount, tax_1_rate, group_id, modifier
     FROM ops.kot_child
     WHERE company_id = $1 AND kot_master_id = $2
     ORDER BY kot_child_id ASC`,
    [companyId, kotMasterId]
  );
  return rows;
}

export async function findKotChild(client, companyId, kotMasterId, kotChildId) {
  const { rows } = await client.query(
    `SELECT kot_child_id, kot_master_id, branch_id, station_id, product_id, barcode,
            short_description, qty, pack_qty, unit_cost, unit_price, amount, item_discount,
            sub_total, line_total,
            tax_1_amount, tax_2_amount, tax_3_amount,
            tax_1_rate, tax_2_rate, tax_3_rate,
            group_id, modifier, kot_display_status
       FROM ops.kot_child
      WHERE company_id = $1 AND kot_master_id = $2 AND kot_child_id = $3
      LIMIT 1`,
    [companyId, kotMasterId, kotChildId],
  );
  return rows[0] ?? null;
}

export async function countKotChildren(client, companyId, kotMasterId) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n
       FROM ops.kot_child
      WHERE company_id = $1 AND kot_master_id = $2`,
    [companyId, kotMasterId],
  );
  return Number(rows[0]?.n || 0);
}

/** SplitMoveChildRow — full line moves to the new master. */
export async function moveKotChildToMaster(client, companyId, kotChildId, fromKotId, toKotId, modifiedBy) {
  const { rowCount } = await client.query(
    `UPDATE ops.kot_child SET
        kot_master_id = $4,
        modified_by = $5,
        modified_at = NOW()
     WHERE company_id = $1
       AND kot_master_id = $2
       AND kot_child_id = $3`,
    [companyId, fromKotId, kotChildId, toKotId, modifiedBy],
  );
  return rowCount;
}

/** SplitMoveChildRow — leftover qty stays on the source child. */
export async function updateKotChildSplitRemain(client, row) {
  const {
    companyId,
    kotMasterId,
    kotChildId,
    qty,
    amount,
    itemDiscount,
    lineTotal,
    subTotal,
    tax1Amount,
    tax2Amount,
    tax3Amount,
    modifiedBy,
  } = row;
  await client.query(
    `UPDATE ops.kot_child SET
        qty = $4,
        amount = $5,
        item_discount = $6,
        line_total = $7,
        sub_total = $8,
        tax_1_amount = $9,
        tax_2_amount = $10,
        tax_3_amount = $11,
        modified_by = $12,
        modified_at = NOW()
     WHERE company_id = $1 AND kot_master_id = $2 AND kot_child_id = $3`,
    [
      companyId,
      kotMasterId,
      kotChildId,
      qty,
      amount,
      itemDiscount,
      lineTotal,
      subTotal,
      tax1Amount,
      tax2Amount,
      tax3Amount,
      modifiedBy,
    ],
  );
}

/** ItemRemovefrm.InsertItemClearTable — qty + tax/discount amounts on a saved line. */
export async function updateKotChildQty(client, row) {
  const {
    companyId,
    kotMasterId,
    kotChildId,
    qty,
    itemDiscount,
    subTotal,
    tax1Amount,
    lineTotal,
    modifiedBy,
  } = row;
  await client.query(
    `UPDATE ops.kot_child SET
        qty = $4,
        item_discount = $5,
        sub_total = $6,
        amount = $6,
        tax_1_amount = $7,
        line_total = $8,
        modified_by = $9,
        modified_at = NOW()
     WHERE company_id = $1 AND kot_master_id = $2 AND kot_child_id = $3`,
    [companyId, kotMasterId, kotChildId, qty, itemDiscount, subTotal, tax1Amount, lineTotal, modifiedBy]
  );
}

export async function updateKotNofCustomer(client, companyId, kotMasterId, nofCustomer, modifiedBy) {
  await client.query(
    `UPDATE ops.kot_master SET
        nof_customer = $3,
        modified_by = $4,
        modified_on = NOW()
     WHERE company_id = $1 AND kot_master_id = $2`,
    [companyId, kotMasterId, nofCustomer, modifiedBy]
  );
}

export async function deleteKotChild(client, companyId, kotMasterId, kotChildId, productId) {
  const params = [companyId, kotMasterId, kotChildId];
  let productSql = '';
  if (productId != null && Number(productId) > 0) {
    params.push(Number(productId));
    productSql = ` AND product_id = $${params.length}`;
  }
  const { rowCount } = await client.query(
    `DELETE FROM ops.kot_child
     WHERE company_id = $1 AND kot_master_id = $2 AND kot_child_id = $3${productSql}`,
    params
  );
  return rowCount;
}

export async function updateKotStatus(client, companyId, kotMasterId, kotStatus, modifiedBy) {
  await client.query(
    `UPDATE ops.kot_master SET
        kot_status = $3,
        modified_by = $4,
        modified_on = NOW()
     WHERE company_id = $1 AND kot_master_id = $2`,
    [companyId, kotMasterId, kotStatus, modifiedBy]
  );
}

export async function resetKotDiscount(client, companyId, kotMasterId, amount, modifiedBy) {
  await client.query(
    `UPDATE ops.kot_master SET
        bill_discount = 0,
        round_off_adj = 0,
        amount = $3,
        modified_by = $4,
        modified_on = NOW()
     WHERE company_id = $1 AND kot_master_id = $2`,
    [companyId, kotMasterId, amount, modifiedBy]
  );
}

export async function updateKotAmount(client, companyId, kotMasterId, amount, modifiedBy) {
  await client.query(
    `UPDATE ops.kot_master SET
        amount = $3,
        modified_by = $4,
        modified_on = NOW()
     WHERE company_id = $1 AND kot_master_id = $2`,
    [companyId, kotMasterId, amount, modifiedBy]
  );
}

export async function deleteKotMaster(client, companyId, kotMasterId) {
  await client.query(
    `DELETE FROM ops.kot_child WHERE company_id = $1 AND kot_master_id = $2`,
    [companyId, kotMasterId]
  );
  const { rowCount } = await client.query(
    `DELETE FROM ops.kot_master WHERE company_id = $1 AND kot_master_id = $2`,
    [companyId, kotMasterId]
  );
  return rowCount;
}

/**
 * VB ItemClearTable insert. ops.item_clear.branch_id is the physical branch
 * (FK to core.branch_master), not the POS station id.
 * Audit insert must never abort item cancel / qty change.
 */
export async function insertItemClear(client, row) {
  try {
    await client.query(
      `INSERT INTO ops.item_clear (
          company_id, branch_id, product_id, cashier_id, supervisor_id,
          counter_no, clear_datetime, bill_no, barcode, description, group_id,
          qty, unit_cost, unit_price, line_total, upload_status
        ) VALUES (
          $1,$2,$3,$4,$5,$6, NOW(), $7,$8,$9,$10,$11,$12,$13,$14,'PENDING'
        )`,
      [
        row.companyId,
        row.branchId,
        row.productId,
        row.cashierId,
        row.supervisorId,
        row.counterNo,
        row.billNo,
        row.barcode ?? '',
        String(row.description ?? '').slice(0, 200),
        row.groupId ?? 0,
        row.qty,
        row.unitCost,
        row.unitPrice,
        row.lineTotal,
      ]
    );
    return true;
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703' || err.code === '23503') {
      console.warn('[item_clear] skipped', err.code, err.detail || err.message);
      return false;
    }
    throw err;
  }
}

/** Prefer a real branch_master row; fall back to the station's parent branch. */
export async function resolveItemClearBranchId(client, companyId, stationId, preferredBranchId) {
  const candidates = [preferredBranchId, stationId]
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);
  for (const id of candidates) {
    const { rows } = await client.query(
      `SELECT branch_id FROM core.branch_master
       WHERE company_id = $1 AND branch_id = $2 AND COALESCE(status, 'ACTIVE') = 'ACTIVE'
       LIMIT 1`,
      [companyId, id]
    );
    if (rows.length) return Number(rows[0].branch_id);
  }
  const sid = Number(stationId);
  if (Number.isFinite(sid) && sid > 0) {
    const { rows } = await client.query(
      `SELECT branch_id FROM core.station_master
       WHERE company_id = $1 AND station_id = $2 AND COALESCE(is_deleted, FALSE) = FALSE
       LIMIT 1`,
      [companyId, sid]
    );
    const bid = Number(rows[0]?.branch_id);
    if (Number.isFinite(bid) && bid > 0) return bid;
  }
  return Number(preferredBranchId) || sid || 0;
}

export async function findKotMastersByIds(client, companyId, stationId, kotMasterIds) {
  const ids = (kotMasterIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return [];
  const { rows } = await client.query(
    `SELECT kot_master_id, kot_status, kot_prefix, kot_number, area_id, table_id, nof_customer, station_id
     FROM ops.kot_master
     WHERE company_id = $1 AND station_id = $2 AND kot_master_id = ANY($3::bigint[])`,
    [companyId, stationId, ids],
  );
  return rows;
}

/** TableFloorRuntimeFrmAreaChange.UpdateKotTable — TableId + AreaID, ChairNo unchanged. */
export async function updateKotAreaTable(
  client,
  companyId,
  stationId,
  kotMasterId,
  tableId,
  areaId,
  modifiedBy,
) {
  const { rowCount } = await client.query(
    `UPDATE ops.kot_master SET
        table_id = $4,
        area_id = $5,
        modified_by = $6,
        modified_on = NOW()
     WHERE company_id = $1
       AND station_id = $2
       AND kot_master_id = $3
       AND UPPER(COALESCE(kot_status, '')) NOT IN ('CANCELLED','COMPLETED')`,
    [companyId, stationId, kotMasterId, tableId, areaId, modifiedBy],
  );
  return rowCount;
}

/** Join_Save_OldStyle step 1 — AreaID / TableID / NofCustomer on the target master. */
export async function updateKotMasterJoinTarget(
  client,
  companyId,
  stationId,
  kotMasterId,
  areaId,
  tableId,
  nofCustomer,
  modifiedBy,
) {
  const { rowCount } = await client.query(
    `UPDATE ops.kot_master SET
        area_id = $4,
        table_id = $5,
        nof_customer = $6,
        modified_by = $7,
        modified_on = NOW()
     WHERE company_id = $1
       AND station_id = $2
       AND kot_master_id = $3`,
    [companyId, stationId, kotMasterId, areaId, tableId, nofCustomer, modifiedBy],
  );
  return rowCount;
}

/** Join_Save_OldStyle step 2 — move KOTChild rows onto the target master. */
export async function reassignKotChildren(client, companyId, targetKotId, sourceKotIds, modifiedBy) {
  const ids = (sourceKotIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return 0;
  const { rowCount } = await client.query(
    `UPDATE ops.kot_child SET
        kot_master_id = $2,
        modified_by = $4,
        modified_at = NOW()
     WHERE company_id = $1
       AND kot_master_id = ANY($3::bigint[])`,
    [companyId, targetKotId, ids, modifiedBy],
  );
  return rowCount;
}

/** Join_Save_OldStyle step 3 — delete other KOTMaster rows (children already moved). */
export async function deleteKotMastersOnly(client, companyId, stationId, kotMasterIds) {
  const ids = (kotMasterIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return 0;
  const { rowCount } = await client.query(
    `DELETE FROM ops.kot_master
     WHERE company_id = $1
       AND station_id = $2
       AND kot_master_id <> 0
       AND kot_master_id = ANY($3::bigint[])`,
    [companyId, stationId, ids],
  );
  return rowCount;
}

/** Join_Save_OldStyle orphan cleanup — masters with no children, not cancelled. */
export async function listOrphanKotMasters(client, companyId, stationId) {
  const { rows } = await client.query(
    `SELECT km.kot_master_id, km.kot_prefix, km.kot_number
     FROM ops.kot_master km
     WHERE km.company_id = $1
       AND km.station_id = $2
       AND UPPER(COALESCE(km.kot_status, '')) NOT IN ('CANCELLED')
       AND NOT EXISTS (
         SELECT 1
         FROM ops.kot_child c
         WHERE c.company_id = km.company_id
           AND c.kot_master_id = km.kot_master_id
       )`,
    [companyId, stationId],
  );
  return rows;
}
