import * as customerService from '../services/customer.service.js';

function handleError(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: fallback });
}

/**
 * GET /api/counter-pos/customers/search?q=xxx&limit=30
 * Auth required. company_id from JWT — customers are company-scoped.
 */
export async function searchCustomers(req, res) {
  try {
    const q       = String(req.query.q || '').trim();
    const limit   = Math.min(Number(req.query.limit) || 30, 100);
    const customers = await customerService.searchCustomers(req.authStaff, q, limit);
    return res.json({ customers });
  } catch (err) {
    return handleError(res, err, 'Customer search failed');
  }
}
