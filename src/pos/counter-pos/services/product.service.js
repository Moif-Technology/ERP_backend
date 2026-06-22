import { pool } from '../../../config/db.js';
import * as productRepo from '../repositories/product.repository.js';

/**
 * Lookup a single product by barcode (or product_code) for the logged-in counter's
 * company + branch. Returns a POS-ready shape.
 */
export async function searchByBarcode(authStaff, barcode) {
  const term = String(barcode || '').trim();
  if (!term) {
    const err = new Error('barcode is required');
    err.status = 400;
    throw err;
  }

  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);

  // Try barcode first, fall back to product_code
  let p = await productRepo.searchProduct(pool, companyId, branchId, { barcode: term });
  if (!p) {
    p = await productRepo.searchProduct(pool, companyId, branchId, { productCode: term });
  }

  if (!p) {
    const err = new Error(`Product not found: ${term}`);
    err.status = 404;
    throw err;
  }

  return mapPosProduct(p, term);
}

function mapPosProduct(p, fallbackBarcode = '') {
  const inv = p.inventory;
  return {
    productId:   p.productId,
    productCode: p.productCode,
    barcode:     p.barcode ?? fallbackBarcode,
    description: p.productName,
    descriptionArabic: p.descriptionArabic ?? null,
    shortName:   p.shortName ?? null,
    unitName:    p.unitName  ?? null,
    groupId:     p.groupId   ?? null,
    subgroupId:  p.subgroupId ?? null,
    unitPrice:   inv.unitPrice,
    vatPer:      inv.outputTax1Rate,
    qtyOnHand:   inv.qtyOnHand,
    minPrice:    inv.minimumRetailPrice,
    maxPrice:    inv.maximumRetailPrice,
  };
}

export async function lookupProducts(authStaff, { q, maxPrice, groupId }) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);
  const products  = await productRepo.lookupProducts(pool, companyId, branchId, { q, maxPrice, groupId });
  return products.map(p => mapPosProduct(p));
}

