import { withTransaction } from '../../config/db.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as productRepo from '../repositories/product.repository.js';
import * as substituteRepo from '../repositories/substitute.repository.js';
import * as subGroupRepo from '../repositories/subGroup.repository.js';
import { generateScopedAutoCode } from '../../utils/autoCode.js';
import { assertLimitAvailable } from '../../core/services/entitlement.service.js';
import { nextDocNo } from '../../shared/services/docSequence.service.js';

function parsePackLines(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((l) => ({
    barcode:          String(l.barcode ?? '').trim().slice(0, 50) || null,
    shortDescription: String(l.shortDescription ?? '').trim().slice(0, 150) || null,
    unit:             String(l.unit ?? '').trim().slice(0, 50) || null,
    packQty:          Math.max(Number(l.packQty) || 1, 0.0001),
    pktDetails:       String(l.pktDetails ?? l.packetDetails ?? '').trim().slice(0, 100) || null,
    discPct:          Number(l.discPct) || 0,
    unitCost:         Number(l.unitCost) || 0,
    avgCost:          Number(l.avgCost) || 0,
    lastCost:         Number(l.lastCost) || 0,
    marginPct:        Number(l.marginPct) || 0,
    unitPrice:        Number(l.unitPrice) || 0,
  }));
}

function trimOrEmpty(v) {
  if (v == null) return '';
  return String(v).trim();
}

function sliceOrNull(v, maxLen) {
  const s = trimOrEmpty(v);
  if (!s) return null;
  return s.slice(0, maxLen);
}

function parseBranchId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

function parseMoney(v, fallback = 0) {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n * 100) / 100;
}

function parseMoney4(v, fallback = 1) {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n * 10000) / 10000;
}

function parseOptionalLong(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

function parseSubSubGroupId(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

/** INDEXES: own_ref_no NUMERIC(18,0) */
function parseOwnRefNo(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).trim());
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function parseNumericIdFromTextOrField(textField, explicitId) {
  const e = parseOptionalLong(explicitId);
  if (e != null) return e;
  const s = trimOrEmpty(textField);
  if (!s || !/^\d+$/.test(s)) return null;
  return parseOptionalLong(s);
}

function parseProductIdentity(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim().toLowerCase();
  if (s === 'yes' || s === 'true') return 1;
  if (s === 'no' || s === 'false') return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

export async function listProducts(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const {
    branchId: branchIdQuery,
    groupId: groupIdQuery,
    subGroupId: subGroupIdQuery,
    barcode: barcodeQuery,
    productCode: productCodeQuery,
    search: searchQuery,
    q: qQuery,
    limit: limitQuery,
  } = query || {};

  let bid = parseBranchId(branchIdQuery);
  if (bid == null) bid = parseBranchId(authStaff.branch_id);
  if (bid == null) {
    const err = new Error('branchId is required (query branchId or set staff default branch)');
    err.status = 400;
    throw err;
  }
  const ok = await branchRepo.branchBelongsToCompany(pool, companyId, bid);
  if (!ok) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }

  const groupId = parseOptionalLong(groupIdQuery);
  const subGroupId = parseOptionalLong(subGroupIdQuery);
  const barcode = trimOrEmpty(barcodeQuery) || null;
  const productCode = trimOrEmpty(productCodeQuery) || null;
  const search = trimOrEmpty(searchQuery ?? qQuery) || null;
  const limit = parseOptionalLong(limitQuery);

  return productRepo.listProductsByCompanyAndBranch(pool, companyId, bid, {
    groupId,
    subGroupId,
    barcode,
    productCode,
    search,
    limit,
  });
}

/**
 * Creates product_master + one product_inventory row for the branch (pricing / stock defaults).
 */
export async function createProduct(pool, body, authStaff) {
  let productCode = trimOrEmpty(body.productCode) || null;
  const wantsAutoProductCode = Boolean(body.autoCode);
  if (productCode && productCode.length > 50) {
    const err = new Error('productCode must be at most 50 characters');
    err.status = 400;
    throw err;
  }

  const productName = trimOrEmpty(body.description ?? body.productName);
  if (!productName) {
    const err = new Error('description (product name) is required');
    err.status = 400;
    throw err;
  }
  if (productName.length > 150) {
    const err = new Error('description must be at most 150 characters');
    err.status = 400;
    throw err;
  }

  const branchId = parseBranchId(body.branchId);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }

  const companyId = Number(authStaff.company_id);
  const branchOk = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!branchOk) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }

  let groupId = parseOptionalLong(body.groupId);
  const subGroupId = parseOptionalLong(body.subGroupId ?? body.subgroupId);
  const subsubgroupId = parseSubSubGroupId(body.subSubGroupId ?? body.subsubgroupId);

  if (subGroupId != null) {
    const sg = await productRepo.findSubGroupRow(pool, companyId, subGroupId);
    if (!sg) {
      const err = new Error('Invalid subGroupId for this company');
      err.status = 400;
      throw err;
    }
    if (Number(sg.branch_id) !== branchId) {
      const err = new Error('Sub-group belongs to a different branch');
      err.status = 400;
      throw err;
    }
    if (groupId != null && Number(sg.group_id) !== groupId) {
      const err = new Error('groupId does not match the selected sub-group');
      err.status = 400;
      throw err;
    }
    groupId = Number(sg.group_id);
  } else if (groupId != null) {
    const gx = await subGroupRepo.groupExistsForCompanyBranch(pool, companyId, branchId, groupId);
    if (!gx) {
      const err = new Error('Invalid groupId for this company and branch');
      err.status = 400;
      throw err;
    }
  }

  const userLabel = (authStaff.staff_name || '').slice(0, 50) || 'system';

  const brandId = parseOptionalLong(body.brandId ?? body.productBrandId) ?? parseNumericIdFromTextOrField(body.productBrand, null);
  const brandName = sliceOrNull(body.productBrand, 100);
  const lastSupplierId =
    parseOptionalLong(body.lastSupplierId) ?? parseNumericIdFromTextOrField(body.lastSupplier, null);
  const supplierRefNo = sliceOrNull(body.supplierRefNo, 100);
  const countryOfOrigin = sliceOrNull(body.origin ?? body.countryOfOrigin, 100);
  const productIdentity = parseProductIdentity(body.productIdentity);
  const unitName = sliceOrNull(body.unit, 50);
  const wantsAutoBarcode = Boolean(body.newBarcode);
  const barcodeType = wantsAutoBarcode ? 'NEW' : null;
  let barcode = sliceOrNull(body.barcode, 50);

  const packQtyMaster = parseMoney4(body.packQty, 1);
  const packQtyInv = parseMoney4(body.supplierPackQty ?? body.packQty, packQtyMaster);

  const unitPrice = parseMoney(body.unitPrice);
  const minUnitPrice = parseMoney(body.minUnitPrice);
  const averageCost = parseMoney(body.averageCost);
  const lastPurchCost = parseMoney(body.lastPurchCost);
  const baseCost = parseMoney(body.baseCost);
  const discountPct = parseMoney(body.discountPct);
  const marginPct = parseMoney(body.marginPct);
  const vatIn = parseMoney(body.vatIn);
  const vatInPct = parseMoney(body.vatInPct);
  const vatOut = parseMoney(body.vatOut);
  const vatOutPct = parseMoney(body.vatOutPct);
  const priceLevel1 = parseMoney(body.priceLevel1);
  const priceLevel2 = parseMoney(body.priceLevel2);
  const priceLevel3 = parseMoney(body.priceLevel3);
  const priceLevel4 = parseMoney(body.priceLevel4);
  const priceLevel5 = parseMoney(body.priceLevel5);

  const qtyOnHand = parseMoney4(body.qtyOnHand, 0);
  const reorderLevel = parseMoney4(body.reorderLevel, 0);
  const reorderQty = parseMoney4(body.reorderQty, 0);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `core.product_master:${companyId}`,
    ]);

    if (!productCode && wantsAutoProductCode) {
      productCode = await nextDocNo(client, { companyId, branchId, sequenceCode: 'PRODUCT' });
    }
    if (!productCode) {
      const err = new Error('productCode is required');
      err.status = 400;
      throw err;
    }

    const existingMaster = await productRepo.findMasterByCompanyAndProductCode(
      client,
      companyId,
      productCode
    );

    let masterRow;
    let productId;
    const productInventoryId = await productRepo.nextProductInventoryId(client, companyId);

    if (existingMaster) {
      productId = Number(existingMaster.product_id);
      const invExists = await productRepo.inventoryExistsForBranchProduct(
        client,
        companyId,
        branchId,
        productId
      );
      if (invExists) {
        const err = new Error('This product code already has inventory for this branch');
        err.status = 409;
        throw err;
      }
      masterRow = existingMaster;
    } else {
      await assertLimitAvailable({
        companyId,
        limitCode: 'products',
        countFn: productRepo.countActiveProducts,
        db: client,
      });
      productId = await productRepo.nextProductId(client, companyId);
      if (wantsAutoBarcode && !barcode) {
        barcode = await generateScopedAutoCode(client, {
          tableName: 'core.product_master',
          codeColumn: 'barcode',
          companyId,
          prefix: body.barcodePrefix || 'BAR',
          padLength: 6,
          maxLength: 50,
        });
      }
      masterRow = await productRepo.insertProductMaster(client, {
        companyId,
        productId,
        productCode,
        barcode,
        ownRefNo: parseOwnRefNo(body.productOwnRefNo ?? body.ownRefNo),
        productName,
        shortName: sliceOrNull(body.shortDescription ?? body.shortName, 150),
        specification: sliceOrNull(body.specification, 250),
        descriptionArabic: sliceOrNull(body.descriptionArabic, 200),
        brandId,
        brandName,
        makeType: sliceOrNull(body.makeType, 50),
        groupId,
        subgroupId: subGroupId,
        subsubgroupId: subsubgroupId,
        unitName,
        productType: sliceOrNull(body.productType, 50) || 'Stock',
        stockType: sliceOrNull(body.stockType, 50) || 'Normal',
        packQty: packQtyMaster,
        packDescription: sliceOrNull(body.packetDetails ?? body.packDescription, 50),
        barcodeType,
        isMasterProduct: true,
        remarks: sliceOrNull(body.remark ?? body.remarks, 500),
        lastSupplierId,
        supplierRefNo,
        countryOfOrigin,
        productIdentity,
        isDailyTransactionItem: false,
        cookingTimeMinutes: parseMoney(body.cookingTimeMinutes, 0),
        parcelCharges: parseMoney(body.parcelCharges, 0),
        additionalCharges: parseMoney(body.additionalCharges, 0),
        counterPopupFlag: false,
        createdBy: userLabel,
        modifiedBy: userLabel,
      });
    }

    const invRow = await productRepo.insertProductInventory(client, {
      companyId,
      branchId,
      productInventoryId,
      productId,
      packQty: packQtyInv,
      qtyOnHand,
      reorderLevel,
      reorderQty,
      correctionFactor: 1,
      lastPurchaseCost: lastPurchCost || baseCost,
      averageCost: averageCost || baseCost,
      unitPrice,
      minimumRetailPrice: minUnitPrice,
      maximumRetailPrice: unitPrice,
      priceLevel1: priceLevel1 || unitPrice,
      priceLevel2: priceLevel2 || 0,
      priceLevel3: priceLevel3 || 0,
      priceLevel4: priceLevel4 || 0,
      priceLevel5: priceLevel5 || 0,
      locationCode: sliceOrNull(body.location, 50),
      marginAmount: 0,
      minimumMarginPercentage: marginPct,
      discountPercentage: discountPct,
      inputTax1Amount: vatIn,
      inputTax1Rate: vatInPct,
      outputTax1Amount: vatOut,
      outputTax1Rate: vatOutPct,
      createdBy: userLabel,
      modifiedBy: userLabel,
    });

    const packLines = parsePackLines(body.packLines);
    if (packLines.length > 0) {
      await productRepo.savePackLines(client, companyId, productId, branchId, packLines);
    }
    const substituteIds = Array.isArray(body.substituteProductIds)
      ? body.substituteProductIds.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    await substituteRepo.saveSubstitutes(client, companyId, productId, substituteIds);
    return { masterRow, invRow, branchId, packLines };
  }).then(({ masterRow, invRow, branchId: bid, packLines }) => ({
    ...formatCreatedProduct(masterRow, invRow, bid),
    packLines,
  }));
}

function formatCreatedProduct(masterRow, invRow, branchId) {
  const m = masterRow;
  const i = invRow;
  return {
    productId: Number(m.product_id),
    companyId: Number(m.company_id),
    productCode: m.product_code,
    barcode: m.barcode,
    ownRefNo: m.own_ref_no != null ? Number(m.own_ref_no) : null,
    productName: m.product_name,
    shortName: m.short_name,
    specification: m.specification,
    descriptionArabic: m.description_arabic,
    brandId: m.brand_id != null ? Number(m.brand_id) : null,
    brandName: m.brand_name ?? null,
    makeType: m.make_type,
    groupId: m.group_id != null ? Number(m.group_id) : null,
    subgroupId: m.subgroup_id != null ? Number(m.subgroup_id) : null,
    subsubgroupId: m.subsubgroup_id != null ? Number(m.subsubgroup_id) : null,
    unitName: m.unit_name,
    productType: m.product_type,
    stockType: m.stock_type,
    packQty: m.pack_qty != null ? Number(m.pack_qty) : 1,
    packDescription: m.pack_description,
    barcodeType: m.barcode_type,
    isMasterProduct: Boolean(m.is_master_product),
    remarks: m.remarks,
    productStatus: m.product_status,
    recordStatus: m.record_status,
    lastSupplierId: m.last_supplier_id != null ? Number(m.last_supplier_id) : null,
    supplierRefNo: m.supplier_ref_no ?? null,
    countryOfOrigin: m.country_of_origin ?? null,
    productIdentity: m.product_identity != null ? Number(m.product_identity) : null,
    cookingTimeMinutes: Number(m.cooking_time_minutes) || 0,
    parcelCharges: Number(m.parcel_charges) || 0,
    additionalCharges: Number(m.additional_charges) || 0,
    counterPopupFlag: Boolean(m.counter_popup_flag),
    createdAt: m.created_at,
    modifiedAt: m.modified_at,
    inventory: {
      branchId: Number(i.branch_id),
      productInventoryId: Number(i.product_inventory_id),
      qtyOnHand: Number(i.qty_on_hand) || 0,
      reorderLevel: Number(i.reorder_level) || 0,
      reorderQty: Number(i.reorder_qty) || 0,
      lastPurchaseCost: Number(i.last_purchase_cost) || 0,
      averageCost: Number(i.average_cost) || 0,
      unitPrice: Number(i.unit_price) || 0,
      minimumRetailPrice: Number(i.minimum_retail_price) || 0,
      maximumRetailPrice: Number(i.maximum_retail_price) || 0,
      priceLevel1: Number(i.price_level_1) || 0,
      priceLevel2: Number(i.price_level_2) || 0,
      priceLevel3: Number(i.price_level_3) || 0,
      priceLevel4: Number(i.price_level_4) || 0,
      priceLevel5: Number(i.price_level_5) || 0,
      locationCode: i.location_code,
      marginAmount: Number(i.margin_amount) || 0,
      minimumMarginPercentage: Number(i.minimum_margin_percentage) || 0,
      discountPercentage: Number(i.discount_percentage) || 0,
      inputTax1Amount: Number(i.input_tax_1_amount) || 0,
      inputTax1Rate: Number(i.input_tax_1_rate) || 0,
      outputTax1Amount: Number(i.output_tax_1_amount) || 0,
      outputTax1Rate: Number(i.output_tax_1_rate) || 0,
    },
  };
}



/**
 * Fetch a single product by productId + branchId.
 * Used by the Edit flow in ProductEntry.jsx.
 */
export async function getProduct(pool, authStaff, productId, query) {
  const companyId = Number(authStaff.company_id);
  const pid = Number(productId);
  if (!Number.isFinite(pid) || pid < 1) {
    const err = new Error('Invalid productId');
    err.status = 400;
    throw err;
  }
 
  // branchId can come from query string or staff default
  let bid = parseBranchId(query?.branchId);
  if (bid == null) bid = parseBranchId(authStaff.branch_id);
  if (bid == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
 
  const ok = await branchRepo.branchBelongsToCompany(pool, companyId, bid);
  if (!ok) {
    const err = new Error('Invalid branch for this company');
    err.status = 403;
    throw err;
  }
 
  const product = await productRepo.findProductByIdAndBranch(pool, companyId, pid, bid);
  if (!product) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }
  const [packLines, substitutes] = await Promise.all([
    productRepo.getPackLines(pool, companyId, pid, bid),
    substituteRepo.listSubstitutes(pool, companyId, pid, bid),
  ]);
  return { ...product, packLines, substitutes };
}
 
/**
 * Update an existing product_master + product_inventory row.
 * productId comes from the URL param.
 */
export async function updateProduct(pool, productId, body, authStaff) {
  const companyId = Number(authStaff.company_id);
  const pid = Number(productId);
  if (!Number.isFinite(pid) || pid < 1) {
    const err = new Error('Invalid productId');
    err.status = 400;
    throw err;
  }

  const productCode = trimOrEmpty(body.productCode);
  if (!productCode) {
    const err = new Error('productCode is required');
    err.status = 400;
    throw err;
  }
  if (productCode.length > 50) {
    const err = new Error('productCode must be at most 50 characters');
    err.status = 400;
    throw err;
  }
 
  const productName = trimOrEmpty(body.description ?? body.productName);
  if (!productName) {
    const err = new Error('description (product name) is required');
    err.status = 400;
    throw err;
  }
  if (productName.length > 150) {
    const err = new Error('description must be at most 150 characters');
    err.status = 400;
    throw err;
  }
 
  const branchId = parseBranchId(body.branchId);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
 
  const branchOk = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!branchOk) {
    const err = new Error('Invalid branch for this company');
    err.status = 403;
    throw err;
  }
 
  // Resolve group / subgroup exactly like createProduct does
  let groupId = parseOptionalLong(body.groupId);
  const subGroupId = parseOptionalLong(body.subGroupId ?? body.subgroupId);
  const subsubgroupId = parseSubSubGroupId(body.subSubGroupId ?? body.subsubgroupId);
 
  if (subGroupId != null) {
    const sg = await productRepo.findSubGroupRow(pool, companyId, subGroupId);
    if (!sg) {
      const err = new Error('Invalid subGroupId for this company');
      err.status = 400;
      throw err;
    }
    if (Number(sg.branch_id) !== branchId) {
      const err = new Error('Sub-group belongs to a different branch');
      err.status = 400;
      throw err;
    }
    if (groupId != null && Number(sg.group_id) !== groupId) {
      const err = new Error('groupId does not match the selected sub-group');
      err.status = 400;
      throw err;
    }
    groupId = Number(sg.group_id);
  } else if (groupId != null) {
    const gx = await subGroupRepo.groupExistsForCompanyBranch(pool, companyId, branchId, groupId);
    if (!gx) {
      const err = new Error('Invalid groupId for this company and branch');
      err.status = 400;
      throw err;
    }
  }
 
  const userLabel = (authStaff.staff_name || '').slice(0, 50) || 'system';
  const brandId = parseOptionalLong(body.brandId ?? body.productBrandId) ?? parseNumericIdFromTextOrField(body.productBrand, null);
  const brandName = sliceOrNull(body.productBrand, 100);
  const lastSupplierId = parseOptionalLong(body.lastSupplierId) ?? parseNumericIdFromTextOrField(body.lastSupplier, null);
  const supplierRefNo = sliceOrNull(body.supplierRefNo, 100);
  const countryOfOrigin = sliceOrNull(body.origin ?? body.countryOfOrigin, 100);
  const productIdentity = parseProductIdentity(body.productIdentity);
 
  const packQtyMaster  = parseMoney4(body.packQty, 1);
  const packQtyInv     = parseMoney4(body.supplierPackQty ?? body.packQty, packQtyMaster);
  const unitPrice      = parseMoney(body.unitPrice);
  const minUnitPrice   = parseMoney(body.minUnitPrice);
  const averageCost    = parseMoney(body.averageCost);
  const lastPurchCost  = parseMoney(body.lastPurchCost);
  const baseCost       = parseMoney(body.baseCost);
  const discountPct    = parseMoney(body.discountPct);
  const marginPct      = parseMoney(body.marginPct);
  const vatIn          = parseMoney(body.vatIn);
  const vatInPct       = parseMoney(body.vatInPct);
  const vatOut         = parseMoney(body.vatOut);
  const vatOutPct      = parseMoney(body.vatOutPct);
  const priceLevel1    = parseMoney(body.priceLevel1);
  const priceLevel2    = parseMoney(body.priceLevel2);
  const priceLevel3    = parseMoney(body.priceLevel3);
  const priceLevel4    = parseMoney(body.priceLevel4);
  const priceLevel5    = parseMoney(body.priceLevel5);
  const qtyOnHand      = parseMoney4(body.qtyOnHand, 0);
  const reorderLevel   = parseMoney4(body.reorderLevel, 0);
  const reorderQty     = parseMoney4(body.reorderQty, 0);
  const wantsAutoBarcode = Boolean(body.newBarcode);
  let barcode = sliceOrNull(body.barcode, 50);
 
  return withTransaction(async (client) => {
    // Lock the master row for this company/product
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `core.product_master:${companyId}:${pid}`,
    ]);
    if (wantsAutoBarcode && !barcode) {
      barcode = await generateScopedAutoCode(client, {
        tableName: 'core.product_master',
        codeColumn: 'barcode',
        companyId,
        prefix: body.barcodePrefix || 'BAR',
        padLength: 6,
        maxLength: 50,
      });
    }

    const masterRow = await productRepo.updateProductMaster(client, companyId, pid, {
      productCode,
      barcode,
      ownRefNo:           parseOwnRefNo(body.productOwnRefNo ?? body.ownRefNo),
      productName,
      shortName:          sliceOrNull(body.shortDescription ?? body.shortName, 150),
      specification:      sliceOrNull(body.specification, 250),
      descriptionArabic:  sliceOrNull(body.descriptionArabic, 200),
      brandId,
      brandName,
      makeType:           sliceOrNull(body.makeType, 50),
      groupId,
      subgroupId:         subGroupId,
      subsubgroupId,
      unitName:           sliceOrNull(body.unit, 50),
      packQty:            packQtyMaster,
      packDescription:    sliceOrNull(body.packetDetails ?? body.packDescription, 50),
      barcodeType:        wantsAutoBarcode ? 'NEW' : null,
      productType:        sliceOrNull(body.productType, 50),
      stockType:          sliceOrNull(body.stockType, 50),
      remarks:            sliceOrNull(body.remark ?? body.remarks, 500),
      lastSupplierId,
      supplierRefNo,
      countryOfOrigin,
      productIdentity,
      modifiedBy:         userLabel,
    });
 
    if (!masterRow) {
      const err = new Error('Product not found or update failed');
      err.status = 404;
      throw err;
    }
 
    const invRow = await productRepo.updateProductInventory(client, companyId, pid, branchId, {
      packQty:                  packQtyInv,
      qtyOnHand,
      reorderLevel,
      reorderQty,
      lastPurchaseCost:         lastPurchCost || baseCost,
      averageCost:              averageCost  || baseCost,
      unitPrice,
      minimumRetailPrice:       minUnitPrice,
      maximumRetailPrice:       unitPrice,
      priceLevel1:              priceLevel1 || unitPrice,
      priceLevel2:              priceLevel2 || 0,
      priceLevel3:              priceLevel3 || 0,
      priceLevel4:              priceLevel4 || 0,
      priceLevel5:              priceLevel5 || 0,
      locationCode:             sliceOrNull(body.location, 50),
      minimumMarginPercentage:  marginPct,
      discountPercentage:       discountPct,
      inputTax1Amount:          vatIn,
      inputTax1Rate:            vatInPct,
      outputTax1Amount:         vatOut,
      outputTax1Rate:           vatOutPct,
      modifiedBy:               userLabel,
    });
 
    if (!invRow) {
      const err = new Error('Product inventory not found for this branch');
      err.status = 404;
      throw err;
    }

    const packLines = parsePackLines(body.packLines);
    await productRepo.savePackLines(client, companyId, pid, branchId, packLines);

    const substituteIds = Array.isArray(body.substituteProductIds)
      ? body.substituteProductIds.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    await substituteRepo.saveSubstitutes(client, companyId, pid, substituteIds);

    return { masterRow, invRow, branchId, packLines };
  }).then(({ masterRow, invRow, branchId: bid, packLines }) => ({
    ...formatCreatedProduct(masterRow, invRow, bid),
    packLines,
  }));
}
