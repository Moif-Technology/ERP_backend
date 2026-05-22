/**
 * Data access for core.product_master + core.product_inventory.
 * Column names match MOIFONE DATABASE INDEXES.txt (# core.product_master / # core.product_inventory).
 */

export async function nextProductId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(product_id), 0) + 1 AS next_id
     FROM core.product_master
     WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].next_id);
}

export async function countActiveProducts(db, companyId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM core.product_master
     WHERE company_id = $1
       AND COALESCE(record_status, 'ACTIVE') = 'ACTIVE'`,
    [companyId]
  );
  return Number(rows[0]?.n || 0);
}

export async function nextProductInventoryId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(product_inventory_id), 0) + 1 AS next_id
     FROM core.product_inventory
     WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].next_id);
}

function emptyToNull(v) {
  if (v == null || v === '') return null;
  return v;
}

export async function insertProductMaster(client, params) {
  const {
    companyId,
    productId,
    productCode,
    barcode,
    ownRefNo,
    productName,
    shortName,
    specification,
    descriptionArabic,
    brandId,
    brandName,
    productType,
    makeType,
    groupId,
    subgroupId,
    subsubgroupId,
    unitName,
    packQty,
    packDescription,
    barcodeType,
    isMasterProduct,
    stockType,
    remarks,
    lastSupplierId,
    supplierRefNo,
    countryOfOrigin,
    productIdentity,
    isDailyTransactionItem,
    cookingTimeMinutes,
    parcelCharges,
    additionalCharges,
    counterPopupFlag,
    createdBy,
    modifiedBy,
  } = params;
  const { rows } = await client.query(
    `INSERT INTO core.product_master (
        company_id, product_id, product_code, barcode, own_ref_no,
        product_name, short_name, specification, description_arabic,
        brand_id, brand_name, product_type, make_type, group_id, subgroup_id, subsubgroup_id,
        unit_name, pack_qty, pack_description, barcode_type,
        is_master_product, stock_type, remarks, product_status, record_status,
        last_supplier_id, supplier_ref_no, country_of_origin,
        product_identity, is_daily_transaction_item, cooking_time_minutes,
        parcel_charges, additional_charges, counter_popup_flag,
        created_by, modified_by
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20,
        $21, $22, $23, 'ACTIVE', 'ACTIVE',
        $24, $25, $26,
        $27, $28, $29,
        $30, $31, $32,
        $33, $34
      )
      RETURNING *`,
    [
      companyId,
      productId,
      productCode,
      emptyToNull(barcode),
      ownRefNo,
      productName,
      emptyToNull(shortName),
      emptyToNull(specification),
      emptyToNull(descriptionArabic),
      brandId,
      emptyToNull(brandName),
      emptyToNull(productType),
      emptyToNull(makeType),
      groupId,
      subgroupId,
      subsubgroupId,
      emptyToNull(unitName),
      packQty,
      emptyToNull(packDescription),
      emptyToNull(barcodeType),
      isMasterProduct,
      emptyToNull(stockType),
      emptyToNull(remarks),
      lastSupplierId,
      emptyToNull(supplierRefNo),
      emptyToNull(countryOfOrigin),
      productIdentity,
      isDailyTransactionItem,
      cookingTimeMinutes,
      parcelCharges,
      additionalCharges,
      counterPopupFlag,
      createdBy,
      modifiedBy,
    ]
  );
  return rows[0];
}

export async function insertProductInventory(client, params) {
  const {
    companyId,
    branchId,
    productInventoryId,
    productId,
    packQty,
    qtyOnHand,
    reorderLevel,
    reorderQty,
    correctionFactor,
    lastPurchaseCost,
    averageCost,
    unitPrice,
    minimumRetailPrice,
    maximumRetailPrice,
    priceLevel1,
    priceLevel2,
    priceLevel3,
    priceLevel4,
    priceLevel5,
    locationCode,
    marginAmount,
    minimumMarginPercentage,
    discountPercentage,
    inputTax1Amount,
    inputTax1Rate,
    outputTax1Amount,
    outputTax1Rate,
    createdBy,
    modifiedBy,
  } = params;
  const { rows } = await client.query(
    `INSERT INTO core.product_inventory (
        company_id, branch_id, product_inventory_id, product_id,
        pack_qty, qty_on_hand, reorder_level, reorder_qty, correction_factor,
        last_purchase_cost, average_cost, unit_price,
        minimum_retail_price, maximum_retail_price,
        price_level_1, price_level_2, price_level_3, price_level_4, price_level_5,
        location_code, margin_amount, minimum_margin_percentage, discount_percentage,
        input_tax_1_amount, input_tax_2_amount, input_tax_3_amount,
        input_tax_1_rate, input_tax_2_rate, input_tax_3_rate,
        output_tax_1_amount, output_tax_2_amount, output_tax_3_amount,
        output_tax_1_rate, output_tax_2_rate, output_tax_3_rate,
        record_status, created_by, modified_by
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19,
        $20, $21, $22, $23,
        $24, 0::numeric, 0::numeric,
        $25, 0::numeric, 0::numeric,
        $26, 0::numeric, 0::numeric,
        $27, 0::numeric, 0::numeric,
        'ACTIVE', $28, $29
      )
      RETURNING *`,
    [
      companyId,
      branchId,
      productInventoryId,
      productId,
      packQty,
      qtyOnHand,
      reorderLevel,
      reorderQty,
      correctionFactor,
      lastPurchaseCost,
      averageCost,
      unitPrice,
      minimumRetailPrice,
      maximumRetailPrice,
      priceLevel1,
      priceLevel2,
      priceLevel3,
      priceLevel4,
      priceLevel5,
      emptyToNull(locationCode),
      marginAmount,
      minimumMarginPercentage,
      discountPercentage,
      inputTax1Amount,
      inputTax1Rate,
      outputTax1Amount,
      outputTax1Rate,
      createdBy,
      modifiedBy,
    ]
  );
  return rows[0];
}

function mapMasterRow(row) {
  return {
    productId: Number(row.product_id),
    companyId: Number(row.company_id),
    productCode: row.product_code,
    barcode: emptyToNull(row.barcode),
    ownRefNo: row.own_ref_no != null ? Number(row.own_ref_no) : null,
    productName: row.product_name,
    shortName: emptyToNull(row.short_name),
    specification: emptyToNull(row.specification),
    descriptionArabic: emptyToNull(row.description_arabic),
    brandId: row.brand_id != null ? Number(row.brand_id) : null,
    brandName: emptyToNull(row.brand_name),
    productType: emptyToNull(row.product_type),
    makeType: emptyToNull(row.make_type),
    groupId: row.group_id != null ? Number(row.group_id) : null,
    subgroupId: row.subgroup_id != null ? Number(row.subgroup_id) : null,
    subsubgroupId: row.subsubgroup_id != null ? Number(row.subsubgroup_id) : null,
    unitName: emptyToNull(row.unit_name),
    packQty: row.pack_qty != null ? Number(row.pack_qty) : 1,
    packDescription: emptyToNull(row.pack_description),
    barcodeType: emptyToNull(row.barcode_type),
    isMasterProduct: Boolean(row.is_master_product),
    stockType: emptyToNull(row.stock_type),
    remarks: emptyToNull(row.remarks),
    productStatus: row.product_status,
    recordStatus: row.record_status,
    lastSupplierId: row.last_supplier_id != null ? Number(row.last_supplier_id) : null,
    supplierRefNo: emptyToNull(row.supplier_ref_no),
    countryOfOrigin: emptyToNull(row.country_of_origin),
    productIdentity: row.product_identity != null ? Number(row.product_identity) : null,
    cookingTimeMinutes: row.cooking_time_minutes != null ? Number(row.cooking_time_minutes) : 0,
    parcelCharges: row.parcel_charges != null ? Number(row.parcel_charges) : 0,
    additionalCharges: row.additional_charges != null ? Number(row.additional_charges) : 0,
    counterPopupFlag: Boolean(row.counter_popup_flag),
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
  };
}

function mapInvRow(row) {
  return {
    branchId: Number(row.branch_id),
    productInventoryId: Number(row.product_inventory_id),
    qtyOnHand: row.qty_on_hand != null ? Number(row.qty_on_hand) : 0,
    reorderLevel: row.reorder_level != null ? Number(row.reorder_level) : 0,
    reorderQty: row.reorder_qty != null ? Number(row.reorder_qty) : 0,
    correctionFactor: row.correction_factor != null ? Number(row.correction_factor) : 1,
    lastPurchaseCost: row.last_purchase_cost != null ? Number(row.last_purchase_cost) : 0,
    averageCost: row.average_cost != null ? Number(row.average_cost) : 0,
    unitPrice: row.unit_price != null ? Number(row.unit_price) : 0,
    minimumRetailPrice: row.minimum_retail_price != null ? Number(row.minimum_retail_price) : 0,
    maximumRetailPrice: row.maximum_retail_price != null ? Number(row.maximum_retail_price) : 0,
    priceLevel1: row.price_level_1 != null ? Number(row.price_level_1) : 0,
    priceLevel2: row.price_level_2 != null ? Number(row.price_level_2) : 0,
    priceLevel3: row.price_level_3 != null ? Number(row.price_level_3) : 0,
    priceLevel4: row.price_level_4 != null ? Number(row.price_level_4) : 0,
    priceLevel5: row.price_level_5 != null ? Number(row.price_level_5) : 0,
    locationCode: emptyToNull(row.location_code),
    marginAmount: row.margin_amount != null ? Number(row.margin_amount) : 0,
    minimumMarginPercentage: row.minimum_margin_percentage != null ? Number(row.minimum_margin_percentage) : 0,
    discountPercentage: row.discount_percentage != null ? Number(row.discount_percentage) : 0,
    inputTax1Amount: row.input_tax_1_amount != null ? Number(row.input_tax_1_amount) : 0,
    inputTax1Rate: row.input_tax_1_rate != null ? Number(row.input_tax_1_rate) : 0,
    outputTax1Amount: row.output_tax_1_amount != null ? Number(row.output_tax_1_amount) : 0,
    outputTax1Rate: row.output_tax_1_rate != null ? Number(row.output_tax_1_rate) : 0,
  };
}

const MASTER_LIST_COLS = `m.product_id, m.company_id, m.product_code, m.barcode, m.own_ref_no,
            m.product_name, m.short_name, m.specification, m.description_arabic,
            m.brand_id, m.brand_name, m.product_type, m.make_type, m.group_id, m.subgroup_id, m.subsubgroup_id,
            m.unit_name, m.pack_qty, m.pack_description, m.barcode_type,
            m.is_master_product, m.stock_type, m.remarks, m.product_status, m.record_status,
            m.last_supplier_id, m.supplier_ref_no, m.country_of_origin,
            m.product_identity, m.cooking_time_minutes, m.parcel_charges, m.additional_charges,
            m.counter_popup_flag, m.created_at, m.modified_at`;

export async function listProductsByCompanyAndBranch(pool, companyId, branchId, {
  groupId = null,
  subGroupId = null,
  barcode = null,
  productCode = null,
  limit = null,
} = {}) {
  const params = [companyId, branchId];
  const extra = [];

  if (groupId != null) {
    params.push(groupId);
    extra.push(`m.group_id = $${params.length}`);
  }
  if (subGroupId != null) {
    params.push(subGroupId);
    extra.push(`m.subgroup_id = $${params.length}`);
  }
  if (barcode != null && String(barcode).trim() !== '') {
    params.push(String(barcode).trim());
    extra.push(`m.barcode = $${params.length}`);
  }
  if (productCode != null && String(productCode).trim() !== '') {
    params.push(String(productCode).trim().toLowerCase());
    extra.push(`LOWER(m.product_code) = $${params.length}`);
  }

  const where = extra.length > 0 ? `AND ${extra.join(' AND ')}` : '';
  const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.min(Math.trunc(Number(limit)), 500)
    : null;
  const limitSql = safeLimit ? `LIMIT ${safeLimit}` : '';

  const { rows } = await pool.query(
    `SELECT ${MASTER_LIST_COLS},
            i.branch_id, i.product_inventory_id, i.qty_on_hand, i.reorder_level, i.reorder_qty,
            i.correction_factor,
            i.last_purchase_cost, i.average_cost, i.unit_price,
            i.minimum_retail_price, i.maximum_retail_price,
            i.price_level_1, i.price_level_2, i.price_level_3, i.price_level_4, i.price_level_5,
            i.location_code, i.margin_amount, i.minimum_margin_percentage, i.discount_percentage,
            i.input_tax_1_amount, i.input_tax_1_rate, i.output_tax_1_amount, i.output_tax_1_rate
     FROM core.product_master m
     INNER JOIN core.product_inventory i
       ON m.company_id = i.company_id AND m.product_id = i.product_id
     WHERE m.company_id = $1
       AND i.branch_id = $2
       AND m.record_status = 'ACTIVE'
       AND i.record_status = 'ACTIVE'
       ${where}
     ORDER BY m.product_name ASC
     ${limitSql}`,
    params
  );
  return rows.map((row) => {
    const inv = mapInvRow(row);
    const master = mapMasterRow(row);
    return { ...master, inventory: inv };
  });
}

/**
 * Privilege checks: fetch pricing info for a product at a branch.
 * Returns { minimumRetailPrice, averageCost, qtyOnHand } or null.
 */
export async function getProductPricingForPrivilege(client, companyId, branchId, productId) {
  const { rows } = await client.query(
    `SELECT i.minimum_retail_price, i.average_cost, i.qty_on_hand
     FROM core.product_inventory i
     WHERE i.company_id = $1 AND i.branch_id = $2 AND i.product_id = $3
     LIMIT 1`,
    [companyId, branchId, productId],
  );
  if (!rows[0]) return null;
  return {
    minimumRetailPrice: Number(rows[0].minimum_retail_price) || 0,
    averageCost: Number(rows[0].average_cost) || 0,
    qtyOnHand: Number(rows[0].qty_on_hand) || 0,
  };
}

export async function findMasterByCompanyAndProductCode(client, companyId, productCode) {
  const { rows } = await client.query(
    `SELECT * FROM core.product_master
     WHERE company_id = $1 AND LOWER(product_code) = LOWER($2)
       AND record_status = 'ACTIVE'
     LIMIT 1`,
    [companyId, productCode]
  );
  return rows[0] ?? null;
}

export async function inventoryExistsForBranchProduct(client, companyId, branchId, productId) {
  const { rows } = await client.query(
    `SELECT 1 FROM core.product_inventory
     WHERE company_id = $1 AND branch_id = $2 AND product_id = $3
     LIMIT 1`,
    [companyId, branchId, productId]
  );
  return rows.length > 0;
}

export async function findSubGroupRow(pool, companyId, subGroupId) {
  const { rows } = await pool.query(
    `SELECT sub_group_id, company_id, branch_id, group_id
     FROM biz.sub_group_master
     WHERE company_id = $1 AND sub_group_id = $2
       AND (r_status IS NULL OR r_status = 'ACTIVE')
     LIMIT 1`,
    [companyId, subGroupId]
  );
  return rows[0] ?? null;
}


/**
 * Fetch a single product_master + product_inventory row by productId + branchId.
 * Returns null if not found.
 */
export async function findProductByIdAndBranch(pool, companyId, productId, branchId) {
  const { rows } = await pool.query(
    `SELECT ${MASTER_LIST_COLS},
            i.branch_id, i.product_inventory_id, i.qty_on_hand, i.reorder_level, i.reorder_qty,
            i.correction_factor,
            i.last_purchase_cost, i.average_cost, i.unit_price,
            i.minimum_retail_price, i.maximum_retail_price,
            i.price_level_1, i.price_level_2, i.price_level_3, i.price_level_4, i.price_level_5,
            i.location_code, i.margin_amount, i.minimum_margin_percentage, i.discount_percentage,
            i.input_tax_1_amount, i.input_tax_1_rate, i.output_tax_1_amount, i.output_tax_1_rate,
            i.pack_qty AS inv_pack_qty
     FROM core.product_master m
     INNER JOIN core.product_inventory i
       ON m.company_id = i.company_id AND m.product_id = i.product_id
     WHERE m.company_id = $1
       AND m.product_id = $2
       AND i.branch_id = $3
       AND m.record_status = 'ACTIVE'
       AND i.record_status = 'ACTIVE'
     LIMIT 1`,
    [companyId, productId, branchId]
  );
  if (!rows[0]) return null;
  const row = rows[0];
  const master = mapMasterRow(row);
  const inv = {
    ...mapInvRow(row),
    // inv-level packQty may differ from master packQty
    packQty: row.inv_pack_qty != null ? Number(row.inv_pack_qty) : 1,
  };
  return { ...master, inventory: inv };
}
 
/**
 * Update product_master fields for a given companyId + productId.
 * Only updates the columns that product entry manages.
 */
export async function updateProductMaster(client, companyId, productId, params) {
  const {
    productCode,
    barcode,
    ownRefNo,
    productName,
    shortName,
    specification,
    descriptionArabic,
    brandId,
    brandName,
    makeType,
    groupId,
    subgroupId,
    subsubgroupId,
    unitName,
    packQty,
    packDescription,
    barcodeType,
    productType,
    stockType,
    remarks,
    lastSupplierId,
    supplierRefNo,
    countryOfOrigin,
    productIdentity,
    modifiedBy,
  } = params;

  const { rows } = await client.query(
    `UPDATE core.product_master SET
        product_code        = $3,
        barcode             = $4,
        own_ref_no          = $5,
        product_name        = $6,
        short_name          = $7,
        specification       = $8,
        description_arabic  = $9,
        brand_id            = $10,
        brand_name          = $11,
        make_type           = $12,
        group_id            = $13,
        subgroup_id         = $14,
        subsubgroup_id      = $15,
        unit_name           = $16,
        pack_qty            = $17,
        pack_description    = $18,
        barcode_type        = $19,
        product_type        = $20,
        stock_type          = $21,
        remarks             = $22,
        last_supplier_id    = $23,
        supplier_ref_no     = $24,
        country_of_origin   = $25,
        product_identity    = $26,
        modified_by         = $27,
        modified_at         = NOW()
     WHERE company_id = $1 AND product_id = $2
     RETURNING *`,
    [
      companyId,
      productId,
      productCode,
      emptyToNull(barcode),
      ownRefNo,
      productName,
      emptyToNull(shortName),
      emptyToNull(specification),
      emptyToNull(descriptionArabic),
      brandId,
      emptyToNull(brandName),
      emptyToNull(makeType),
      groupId,
      subgroupId,
      subsubgroupId,
      emptyToNull(unitName),
      packQty,
      emptyToNull(packDescription),
      emptyToNull(barcodeType),
      emptyToNull(productType),
      emptyToNull(stockType),
      emptyToNull(remarks),
      lastSupplierId,
      emptyToNull(supplierRefNo),
      emptyToNull(countryOfOrigin),
      productIdentity,
      modifiedBy,
    ]
  );
  return rows[0] ?? null;
}
 
/**
 * Update product_inventory fields for a given companyId + productId + branchId.
 */
export async function updateProductInventory(client, companyId, productId, branchId, params) {
  const {
    packQty,
    qtyOnHand,
    reorderLevel,
    reorderQty,
    lastPurchaseCost,
    averageCost,
    unitPrice,
    minimumRetailPrice,
    maximumRetailPrice,
    priceLevel1,
    locationCode,
    minimumMarginPercentage,
    discountPercentage,
    inputTax1Amount,
    inputTax1Rate,
    outputTax1Amount,
    outputTax1Rate,
    modifiedBy,
  } = params;
 
  const { rows } = await client.query(
    `UPDATE core.product_inventory SET
        pack_qty                    = $4,
        qty_on_hand                 = $5,
        reorder_level               = $6,
        reorder_qty                 = $7,
        last_purchase_cost          = $8,
        average_cost                = $9,
        unit_price                  = $10,
        minimum_retail_price        = $11,
        maximum_retail_price        = $12,
        price_level_1               = $13,
        location_code               = $14,
        minimum_margin_percentage   = $15,
        discount_percentage         = $16,
        input_tax_1_amount          = $17,
        input_tax_1_rate            = $18,
        output_tax_1_amount         = $19,
        output_tax_1_rate           = $20,
        modified_by                 = $21,
        modified_at                 = NOW()
     WHERE company_id = $1 AND product_id = $2 AND branch_id = $3
     RETURNING *`,
    [
      companyId,
      productId,
      branchId,
      packQty,
      qtyOnHand,
      reorderLevel,
      reorderQty,
      lastPurchaseCost,
      averageCost,
      unitPrice,
      minimumRetailPrice,
      maximumRetailPrice,
      priceLevel1,
      emptyToNull(locationCode),
      minimumMarginPercentage,
      discountPercentage,
      inputTax1Amount,
      inputTax1Rate,
      outputTax1Amount,
      outputTax1Rate,
      modifiedBy,
    ]
  );
  return rows[0] ?? null;
}
