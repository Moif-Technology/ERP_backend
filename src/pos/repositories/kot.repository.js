/**
 * Data access for ops.kot_master + ops.kot_child (POS KOT).
 */

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

export async function nextKotNumber(client, companyId, branchId, prefix) {
  const p = prefix == null ? '' : String(prefix);
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(kot_number), 0) + 1 AS n
     FROM ops.kot_master
     WHERE company_id = $1 AND branch_id = $2 AND COALESCE(kot_prefix, '') = $3`,
    [companyId, branchId, p]
  );
  return Number(rows[0].n);
}

export async function findKotMaster(client, companyId, kotMasterId) {
  const { rows } = await client.query(
    `SELECT kot_master_id, branch_id, kot_number, kot_prefix, area_id, table_id, chair_no
     FROM ops.kot_master
     WHERE company_id = $1 AND kot_master_id = $2`,
    [companyId, kotMasterId]
  );
  return rows[0] ?? null;
}

export async function insertKotMaster(client, row) {
  const {
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
  } = row;
  await client.query(
    `INSERT INTO ops.kot_master (
        company_id, branch_id, kot_master_id, kot_number, kot_prefix, kot_status,
        kot_date, kot_time, customer_id, area_id, table_id, chair_no, waiter_id,
        bill_discount, amount, sub_total_m,
        tax1_amount_m, tax2_amount_m, tax3_amount_m,
        tax1_rate_m, tax2_rate_m, tax3_rate_m,
        round_off_adj, nof_customer, remarks,
        created_by, modified_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6, NOW(), NOW(), $7,$8,$9,$10,$11,
        $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
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
        created_by, modified_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
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
    ]
  );
}

/** Settlement: status, branch, existing bill link (bill_id = sales_id per INDEXES). */
export async function findKotMasterSettlement(client, companyId, kotMasterId) {
  try {
    const { rows } = await client.query(
      `SELECT kot_master_id, branch_id, kot_status, bill_id
       FROM ops.kot_master
       WHERE company_id = $1 AND kot_master_id = $2`,
      [companyId, kotMasterId]
    );
    return rows[0] ?? null;
  } catch (e) {
    if (e.code === '42703') {
      const { rows } = await client.query(
        `SELECT kot_master_id, branch_id, kot_status, NULL::bigint AS bill_id
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
export async function listOpenKots(executor, companyId, branchId, { areaId, kotNumberSearch } = {}) {
  const params = [companyId, branchId];
  const clauses = [
    `km.company_id = $1`,
    `km.branch_id = $2`,
    `km.kot_status != 'SETTLED'`,
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

  const { rows } = await executor.query(
    `SELECT
        km.kot_master_id,
        km.kot_number,
        km.kot_prefix,
        km.kot_time,
        km.amount,
        km.chair_no,
        km.area_id,
        km.table_id,
        COALESCE(am.area_name, '') AS area_name,
        COALESCE(am.supply_type, '') AS supply_type,
        COALESCE(tm.table_name, '') AS table_name
     FROM ops.kot_master km
     LEFT JOIN core.area_master am
       ON am.company_id = km.company_id
      AND am.branch_id = km.branch_id
      AND am.area_id = km.area_id
     LEFT JOIN core.table_master tm
       ON tm.company_id = km.company_id
      AND tm.branch_id = km.branch_id
      AND tm.table_id = km.table_id
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
        km.area_id,
        km.table_id,
        km.chair_no,
        am.area_name,
        kc.kot_child_id,
        kc.product_id,
        kc.short_description,
        kc.qty,
        kc.unit_price,
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
     LEFT JOIN core.area_master am
       ON am.company_id = km.company_id
      AND am.branch_id = km.branch_id
      AND am.area_id = km.area_id
     JOIN ops.kot_child kc
       ON kc.company_id = km.company_id
      AND kc.kot_master_id = km.kot_master_id
     WHERE km.company_id = $1 AND km.kot_master_id = $2
     ORDER BY kc.kot_child_id ASC`,
    [companyId, kotMasterId]
  );
  return rows;
}
