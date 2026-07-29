/**
 * Salon POS settlement endpoint.
 */
import { pool } from '../../../config/db.js';
import * as salesService from '../services/sales.service.js';

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
    if (err.status) {
      return res.status(err.status).json({
        ok: false,
        code: err.code ?? null,
        message: err.message,
      });
    }
    console.error('[salon settlement]', err);
    return res.status(500).json({ ok: false, code: 'INTERNAL', message: 'Settlement failed' });
  }
}
