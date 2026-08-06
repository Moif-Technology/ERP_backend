/**
 * Salon POS settlement + sales viewer endpoints.
 */
import { pool } from '../../../config/db.js';
import * as salesService from '../services/sales.service.js';

function handleError(res, err, fallback) {
  if (err.status) {
    return res.status(err.status).json({
      ok: false,
      code: err.code ?? null,
      message: err.message,
    });
  }
  console.error('[salon sales]', err);
  return res.status(500).json({
    ok: false,
    code: 'INTERNAL',
    message: fallback,
  });
}

/** POST /api/salon-pos/sales/settle */
export async function settle(req, res) {
  try {
    const result = await salesService.settleSale(pool, req.body ?? {}, req.authStaff);

    req.systemLogContext = {
      companyId: Number(req.authStaff?.company_id),
      branchId: Number(req.authStaff?.branch_id),
      actor: req.authStaff?.staff_name,
      message: `Salon settlement ${result.billNo} for job ${result.jobId}`,
    };

    return res.json(result);
  } catch (err) {
    return handleError(res, err, 'Settlement failed');
  }
}

/** GET /api/salon-pos/sales/viewer */
export async function salesViewerList(req, res) {
  try {
    const bills = await salesService.listSalesViewer(pool, req.authStaff, req.query);
    return res.json({ bills });
  } catch (err) {
    return handleError(res, err, 'Failed to load sales viewer');
  }
}

/** GET /api/salon-pos/sales/viewer/:salesId */
export async function salesViewerBill(req, res) {
  try {
    const data = await salesService.getSalesViewerBill(
      pool,
      req.authStaff,
      req.params.salesId,
    );
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Failed to load bill detail');
  }
}

/** GET /api/salon-pos/sales/reports/salesman-wise */
export async function salesmanWiseReport(req, res) {
  try {
    const rows = await salesService.salesmanWiseReport(pool, req.authStaff, req.query);
    return res.json({ rows });
  } catch (err) {
    return handleError(res, err, 'Failed to load salesman-wise report');
  }
}

/** GET /api/salon-pos/sales/reports/item-wise */
export async function itemWiseReport(req, res) {
  try {
    const rows = await salesService.itemWiseReport(pool, req.authStaff, req.query);
    return res.json({ rows });
  } catch (err) {
    return handleError(res, err, 'Failed to load item-wise report');
  }
}

/** GET /api/salon-pos/sales/reports/group-wise */
export async function groupWiseReport(req, res) {
  try {
    const rows = await salesService.groupWiseReport(pool, req.authStaff, req.query);
    return res.json({ rows });
  } catch (err) {
    return handleError(res, err, 'Failed to load group-wise report');
  }
}
