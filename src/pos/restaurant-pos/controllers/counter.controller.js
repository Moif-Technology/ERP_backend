import { pool } from '../../../config/db.js';
import * as counterService from '../services/counter.service.js';

function handleError(res, err, fallback) {
  if (err.status) {
    return res.status(err.status).json({ ok: false, code: err.code ?? null, message: err.message });
  }
  console.error('[restaurant counter]', err);
  return res.status(500).json({ ok: false, message: err.message || fallback });
}

/** GET /api/pos/counter/summary — RptCounterCloseDetailsPending.DisplayDetails */
export async function getSummary(req, res) {
  try {
    const data = await counterService.getSummary(pool, req.authStaff, req.query ?? {});
    return res.status(200).json({ ok: true, ...data });
  } catch (err) {
    return handleError(res, err, 'Could not load counter close');
  }
}

/** POST /api/pos/counter/close — PrintSalesReportSummary (Z) / X-Report snapshot */
export async function closeCounter(req, res) {
  try {
    const result = await counterService.closeCounter(pool, req.authStaff, req.body ?? {});
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return handleError(res, err, 'Could not close counter');
  }
}
