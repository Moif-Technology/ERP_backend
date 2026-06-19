import * as productService from '../services/product.service.js';

function handleError(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: fallback });
}

/**
 * GET /api/counter-pos/products/search?barcode=xxx
 * Auth required. company_id + branch_id come from req.authStaff (JWT).
 */
export async function searchByBarcode(req, res) {
  try {
    const product = await productService.searchByBarcode(req.authStaff, req.query.barcode);
    return res.json({ product });
  } catch (err) {
    return handleError(res, err, 'Product lookup failed');
  }
}

export async function lookupProducts(req, res) {
  try {
    const { q = '', maxPrice, groupId } = req.query;
    const products = await productService.lookupProducts(req.authStaff, { q, maxPrice, groupId });
    return res.json({ products });
  } catch (err) {
    return handleError(res, err, 'Product lookup failed');
  }
}
