/**
 * RptInventoryfrm / ProductInventory.rpt — join query, no SQL view.
 * VB read ProductMasterChildView; here we join product_master + product_inventory
 * plus brand / group / supplier. Branch = legacy StationID.
 */

const QTY_OPS = new Set(['>', '<', '=', '>=', '<=', '<>']);

function numId(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.trunc(n);
}

function filterSql(filters, params) {
  const extra = [];

  const supplierId = numId(filters.supplierId);
  if (supplierId != null) {
    params.push(supplierId);
    extra.push(`m.last_supplier_id = $${params.length}`);
  }

  const brandId = numId(filters.brandId);
  if (brandId != null) {
    params.push(brandId);
    extra.push(`m.brand_id = $${params.length}`);
  }

  const groupId = numId(filters.groupId);
  if (groupId != null) {
    params.push(groupId);
    extra.push(`m.group_id = $${params.length}`);
  }

  const subGroupId = numId(filters.subGroupId);
  if (subGroupId != null) {
    params.push(subGroupId);
    extra.push(`m.subgroup_id = $${params.length}`);
  }

  const subSubGroupId = numId(filters.subSubGroupId);
  if (subSubGroupId != null) {
    params.push(subSubGroupId);
    extra.push(`m.subsubgroup_id = $${params.length}`);
  }

  const location = String(filters.location ?? '').trim();
  if (location) {
    params.push(location);
    extra.push(`i.location_code = $${params.length}`);
  }

  const productType = String(filters.productType ?? '').trim();
  if (productType) {
    params.push(productType);
    extra.push(`UPPER(TRIM(COALESCE(m.product_type, ''))) = UPPER($${params.length})`);
  }

  const name = String(filters.name ?? filters.productName ?? filters.q ?? filters.search ?? '')
    .trim()
    .replace(/[%_]/g, '');
  if (name) {
    params.push(`%${name}%`);
    extra.push(`(
      COALESCE(m.product_name, '') ILIKE $${params.length}
      OR COALESCE(m.short_name, '') ILIKE $${params.length}
      OR COALESCE(m.barcode, '') ILIKE $${params.length}
    )`);
  }

  const qtyRaw = filters.qty;
  const hasQty = qtyRaw != null && String(qtyRaw).trim() !== '';
  if (hasQty) {
    const op = QTY_OPS.has(String(filters.qtyOp ?? '').trim()) ? String(filters.qtyOp).trim() : '<>';
    params.push(Number(qtyRaw) || 0);
    extra.push(`COALESCE(i.qty_on_hand, 0) ${op} $${params.length}`);
  }

  return extra.length ? `AND ${extra.join(' AND ')}` : '';
}

function stockSelect(uniqueExpr) {
  return `SELECT m.product_id,
            ${uniqueExpr} AS unique_multi_product_id,
            COALESCE(m.barcode, '') AS barcode,
            COALESCE(m.product_name, '') AS product_name,
            COALESCE(m.short_name, '') AS short_name,
            m.brand_id,
            COALESCE(b.brand_name, m.brand_name, '') AS brand_name,
            m.group_id,
            COALESCE(g.group_description, '') AS group_name,
            m.subgroup_id,
            COALESCE(sg.sub_group_description, '') AS sub_group_name,
            m.subsubgroup_id,
            COALESCE(ssg.sub_sub_group_description, '') AS sub_sub_group_name,
            m.last_supplier_id,
            COALESCE(sp.supplier_name, '') AS supplier_name,
            COALESCE(i.pack_qty, m.pack_qty, 1) AS pack_qty,
            COALESCE(i.qty_on_hand, 0) AS qty_on_hand,
            COALESCE(i.last_purchase_cost, 0) AS last_purchase_cost,
            COALESCE(i.average_cost, 0) AS average_cost,
            COALESCE(i.unit_price, 0) AS unit_price,
            COALESCE(i.location_code, '') AS location_code,
            COALESCE(m.product_type, '') AS product_type,
            COALESCE(m.stock_type, '') AS stock_type`;
}

const STOCK_FROM = `FROM core.product_master m
       INNER JOIN core.product_inventory i
         ON i.company_id = m.company_id AND i.product_id = m.product_id
       LEFT JOIN core.product_brand b
         ON b.company_id = m.company_id AND b.brand_id = m.brand_id
       LEFT JOIN biz.group_master g
         ON g.company_id = m.company_id
        AND g.group_id = m.group_id
        AND g.branch_id = i.branch_id
       LEFT JOIN biz.sub_group_master sg
         ON sg.company_id = m.company_id AND sg.sub_group_id = m.subgroup_id
       LEFT JOIN biz.sub_sub_group_master ssg
         ON ssg.company_id = m.company_id AND ssg.sub_sub_group_id = m.subsubgroup_id
       LEFT JOIN biz.supplier_master sp
         ON sp.company_id = m.company_id AND sp.supplier_id = m.last_supplier_id`;

function stockSql(uniqueExpr, orderExpr, where) {
  return `${stockSelect(uniqueExpr)}
       ${STOCK_FROM}
      WHERE m.company_id = $1
        AND i.branch_id = $2
        AND COALESCE(m.record_status, 'ACTIVE') = 'ACTIVE'
        AND COALESCE(i.record_status, 'ACTIVE') = 'ACTIVE'
        AND UPPER(REPLACE(TRIM(COALESCE(m.stock_type, '')), '-', ' ')) <> 'NON INVENTORY'
        ${where}
      ORDER BY ${orderExpr} ASC,
               COALESCE(i.pack_qty, m.pack_qty, 1) DESC
      LIMIT 8000`;
}

function catalogueGroupSql(filters, params, catalogueGroupIds) {
  const extra = [];
  if (Array.isArray(catalogueGroupIds) && catalogueGroupIds.length > 0) {
    params.push(catalogueGroupIds);
    extra.push(`m.group_id = ANY($${params.length}::bigint[])`);
  }
  const userFilters = filterSql(filters, params);
  if (extra.length) {
    return `AND ${extra.join(' AND ')}${userFilters ? ` ${userFilters}` : ''}`;
  }
  return userFilters;
}

export async function listInventoryStock(pool, companyId, branchId, filters = {}, catalogueGroupIds = []) {
  const params = [companyId, branchId];
  const where = catalogueGroupSql(filters, params, catalogueGroupIds);
  const uniqueExpr =
    'COALESCE(m.unique_multi_product_id, i.unique_multi_product_id, m.product_id)';
  try {
    const { rows } = await pool.query(stockSql(uniqueExpr, uniqueExpr, where), params);
    return rows;
  } catch (err) {
    if (err.code !== '42703') throw err;
    const { rows } = await pool.query(stockSql('m.product_id', 'm.product_id', where), params);
    return rows;
  }
}

/**
 * Groups for this company + physical branch. Restaurant tills keep MOH- menu
 * groups only (same rule as POS mapGroups) so Counter POS grocery on the same
 * Head Office branch is not mixed into Deyno Pro stock.
 */
export async function listCatalogueGroups(pool, companyId, branchId, stationType) {
  const { rows } = await pool.query(
    `SELECT group_id, group_code, group_description
       FROM biz.group_master
      WHERE company_id = $1
        AND branch_id = $2
        AND (r_status IS NULL OR UPPER(TRIM(r_status)) = 'ACTIVE')
      ORDER BY sort_order ASC, group_description ASC NULLS LAST, group_id ASC`,
    [companyId, branchId],
  );
  const mapped = rows
    .map((r) => ({
      id: Number(r.group_id),
      code: String(r.group_code ?? ''),
      name: String(r.group_description ?? ''),
    }))
    .filter((g) => g.id > 0);
  const type = String(stationType || '').toUpperCase().replace(/-/g, '_');
  if (type === 'RESTAURANT_POS') {
    const moh = mapped.filter((g) => g.code.toUpperCase().startsWith('MOH-'));
    if (moh.length) return moh;
  }
  return mapped;
}

async function safeRows(promise) {
  try {
    const { rows } = await promise;
    return rows;
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') return [];
    throw err;
  }
}

export async function listLookups(pool, companyId, branchId) {
  const [brandRows, supplierRows, locationRows] = await Promise.all([
    safeRows(
      pool.query(
        `SELECT brand_id, brand_name
           FROM core.product_brand
          WHERE company_id = $1
            AND COALESCE(record_status, 'ACTIVE') = 'ACTIVE'
          ORDER BY brand_name ASC
          LIMIT 2000`,
        [companyId],
      ),
    ),
    safeRows(
      pool.query(
        `SELECT supplier_id, supplier_name, COALESCE(supplier_code, '') AS supplier_code
           FROM biz.supplier_master
          WHERE company_id = $1
            AND COALESCE(record_status, 'ACTIVE') = 'ACTIVE'
          ORDER BY supplier_name ASC
          LIMIT 2000`,
        [companyId],
      ),
    ),
    safeRows(
      pool.query(
        `SELECT DISTINCT location_code
           FROM core.product_inventory
          WHERE company_id = $1
            AND branch_id = $2
            AND COALESCE(record_status, 'ACTIVE') = 'ACTIVE'
            AND COALESCE(location_code, '') <> ''
          ORDER BY location_code DESC`,
        [companyId, branchId],
      ),
    ),
  ]);

  return {
    brands: brandRows.map((r) => ({
      id: Number(r.brand_id),
      name: String(r.brand_name ?? ''),
    })),
    suppliers: supplierRows.map((r) => ({
      id: Number(r.supplier_id),
      name: String(r.supplier_name ?? ''),
      code: String(r.supplier_code ?? ''),
    })),
    locations: locationRows.map((r) => String(r.location_code ?? '')).filter(Boolean),
  };
}

function nameFilterSql(filters, params) {
  const name = String(filters.name ?? filters.productName ?? filters.q ?? filters.search ?? '')
    .trim()
    .replace(/[%_]/g, '');
  if (!name) return '';
  params.push(`%${name}%`);
  return `AND (
      COALESCE(m.product_name, '') ILIKE $${params.length}
      OR COALESCE(m.short_name, '') ILIKE $${params.length}
      OR COALESCE(m.barcode, '') ILIKE $${params.length}
    )`;
}

function catalogueOnlySql(params, catalogueGroupIds) {
  if (!Array.isArray(catalogueGroupIds) || catalogueGroupIds.length < 1) return '';
  params.push(catalogueGroupIds);
  return `AND m.group_id = ANY($${params.length}::bigint[])`;
}

/**
 * Movement summary from ops.product_log_entry (signed qty: + in, − out).
 * Opening = on-hand now − period net − movements after To-date.
 * Closing = Opening + In − Out.
 */
export async function listStockMovementSummary(
  pool,
  companyId,
  branchId,
  dateFrom,
  dateTo,
  filters = {},
  catalogueGroupIds = [],
) {
  const params = [companyId, branchId, dateFrom, dateTo];
  const nameSql = nameFilterSql(filters, params);
  const catSql = catalogueOnlySql(params, catalogueGroupIds);
  const movedOnly = nameSql ? '' : 'AND period.product_id IS NOT NULL';
  const { rows } = await pool.query(
    `WITH period AS (
        SELECT product_id,
               COALESCE(SUM(CASE WHEN qty > 0 THEN qty ELSE 0 END), 0) AS in_qty,
               COALESCE(SUM(CASE WHEN qty < 0 THEN ABS(qty) ELSE 0 END), 0) AS out_qty
          FROM ops.product_log_entry
         WHERE company_id = $1
           AND branch_id = $2
           AND transaction_date >= $3::date
           AND transaction_date < ($4::date + interval '1 day')
         GROUP BY product_id
      ),
      after_log AS (
        SELECT product_id, COALESCE(SUM(qty), 0) AS net_qty
          FROM ops.product_log_entry
         WHERE company_id = $1
           AND branch_id = $2
           AND transaction_date >= ($4::date + interval '1 day')
         GROUP BY product_id
      )
      SELECT m.product_id,
             COALESCE(m.barcode, '') AS barcode,
             COALESCE(m.product_name, COALESCE(m.short_name, '')) AS product_name,
             COALESCE(g.group_description, '') AS group_name,
             COALESCE(i.qty_on_hand, 0) AS qty_on_hand,
             COALESCE(period.in_qty, 0) AS in_qty,
             COALESCE(period.out_qty, 0) AS out_qty,
             COALESCE(after_log.net_qty, 0) AS after_net
        FROM core.product_master m
        INNER JOIN core.product_inventory i
          ON i.company_id = m.company_id AND i.product_id = m.product_id
        LEFT JOIN biz.group_master g
          ON g.company_id = m.company_id
         AND g.group_id = m.group_id
         AND g.branch_id = i.branch_id
        LEFT JOIN period ON period.product_id = m.product_id
        LEFT JOIN after_log ON after_log.product_id = m.product_id
       WHERE m.company_id = $1
         AND i.branch_id = $2
         AND COALESCE(m.record_status, 'ACTIVE') = 'ACTIVE'
         AND COALESCE(i.record_status, 'ACTIVE') = 'ACTIVE'
         AND UPPER(REPLACE(TRIM(COALESCE(m.stock_type, '')), '-', ' ')) <> 'NON INVENTORY'
         ${catSql}
         ${nameSql}
         ${movedOnly}
       ORDER BY COALESCE(m.product_name, '') ASC
       LIMIT 8000`,
    params,
  );
  return rows;
}

function movementTypeLabel(rawType, qty) {
  const t = String(rawType || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const q = Number(qty) || 0;
  if (t === 'SALES' || t === 'SALE') return q > 0 ? 'Sales Return' : 'Sales';
  if (t === 'RETURN' || t === 'SALES_RETURN' || t === 'SALESRETURN') return 'Sales Return';
  if (t === 'PURCHASE') return q < 0 ? 'Purchase Return' : 'Purchase';
  if (t === 'PURCHASE_RETURN' || t === 'PURCHASERETURN') return 'Purchase Return';
  if (t === 'ADJUSTMENT' || t === 'STOCK_ADJUSTMENT' || t === 'SA') return 'Stock Adjustment';
  if (t === 'TRANSFER' || t === 'TR') return 'Transfer';
  if (t === 'RECEIVE' || t === 'RECEIPT' || t === 'RC') return 'Receive Transfer';
  if (t === 'GRN') return 'GRN';
  if (t === 'DAMAGE') return 'Damage';
  if (t === 'OPENING' || t === 'OPENING_STOCK') return 'Opening Stock';
  return String(rawType || 'Movement').trim() || 'Movement';
}

/** Line-level ledger for the same date / name scope. */
export async function listStockMovementLines(
  pool,
  companyId,
  branchId,
  dateFrom,
  dateTo,
  filters = {},
  catalogueGroupIds = [],
) {
  const params = [companyId, branchId, dateFrom, dateTo];
  const nameSql = nameFilterSql(filters, params);
  const catSql = catalogueOnlySql(params, catalogueGroupIds);
  const { rows } = await pool.query(
    `SELECT ple.product_log_id,
            ple.product_id,
            COALESCE(m.barcode, '') AS barcode,
            COALESCE(m.product_name, COALESCE(m.short_name, '')) AS product_name,
            COALESCE(g.group_description, '') AS group_name,
            ple.transaction_date,
            COALESCE(ple.transaction_type, '') AS transaction_type,
            ple.transaction_id,
            COALESCE(sm.bill_no::text, ple.transaction_id::text, '') AS document_no,
            COALESCE(ple.qty, 0) AS qty,
            COALESCE(ple.balance_qty, 0) AS balance_qty
       FROM ops.product_log_entry ple
       INNER JOIN core.product_master m
         ON m.company_id = ple.company_id AND m.product_id = ple.product_id
       LEFT JOIN core.product_inventory i
         ON i.company_id = ple.company_id
        AND i.product_id = ple.product_id
        AND i.branch_id = ple.branch_id
       LEFT JOIN biz.group_master g
         ON g.company_id = m.company_id
        AND g.group_id = m.group_id
        AND g.branch_id = ple.branch_id
       LEFT JOIN ops.sales_master sm
         ON sm.company_id = ple.company_id
        AND sm.sales_id = ple.transaction_id
        AND UPPER(REPLACE(TRIM(COALESCE(ple.transaction_type, '')), '-', '_'))
            IN ('SALES', 'SALE', 'RETURN', 'SALES_RETURN', 'SALESRETURN')
      WHERE ple.company_id = $1
        AND ple.branch_id = $2
        AND ple.transaction_date >= $3::date
        AND ple.transaction_date < ($4::date + interval '1 day')
        AND COALESCE(m.record_status, 'ACTIVE') = 'ACTIVE'
        AND UPPER(REPLACE(TRIM(COALESCE(m.stock_type, '')), '-', ' ')) <> 'NON INVENTORY'
        ${catSql}
        ${nameSql}
      ORDER BY COALESCE(m.product_name, '') ASC, ple.product_log_id ASC
      LIMIT 20000`,
    params,
  );
  return rows.map((r) => ({
    ...r,
    type_label: movementTypeLabel(r.transaction_type, r.qty),
  }));
}

export async function companyHeadings(pool, companyId, authStaff) {
  const { rows } = await pool.query(
    `SELECT company_name, company_address
       FROM core.company_master
      WHERE company_id = $1
      LIMIT 1`,
    [companyId],
  );
  const row = rows[0] ?? {};
  return {
    heading1: String(authStaff?.company_name || row.company_name || '').trim(),
    heading2: String(authStaff?.company_address || row.company_address || '').trim(),
    heading4: String(authStaff?.branch_name || '').trim(),
  };
}
