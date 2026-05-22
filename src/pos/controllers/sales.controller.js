import { pool } from '../../config/db.js';
import * as salesService from '../services/sales.service.js';

export async function settle(req, res) {
  const b = req.body ?? {};
  const itemLen = Array.isArray(b.items) ? b.items.length : Array.isArray(b.Items) ? b.Items.length : 0;
  console.log('[settlement] POST', {
    kotId: b.kotId ?? b.kotMasterId ?? b.KotMasterID,
    stationId: b.stationId ?? b.StationID,
    netAmount: b.netAmount,
    paidAmount: b.paidAmount,
    itemCount: itemLen,
    companyId: req.authStaff?.company_id,
  });
  try {
    const out = await salesService.settleSale(pool, req.body, req.authStaff);
    console.log('[settlement] OK', { salesId: out.salesId, billNo: out.billNo });
    return res.status(200).json(out);
  } catch (err) {
    if (err.status) {
      console.warn('[settlement] client error', err.status, err.message);
      return res.status(err.status).json({ ok: false, message: err.message });
    }
    if (err.code === '42P01') {
      return res.status(503).json({
        ok: false,
        message: 'Sales tables not installed. Run database/migrations/019_ops_sales_settlement.sql.',
      });
    }
    if (err.code === '42703') {
      console.error('[settlement] undefined column', err.message);
      return res.status(503).json({
        ok: false,
        message: `${err.message} Apply migrations 020_ops_settlement_link_columns.sql and 021_ops_sales_settlement_api_columns.sql if needed.`,
      });
    }
    console.error('[settlement] FAILED', err.code, err.message, err.detail || '', err.stack || '');
    return res.status(500).json({
      ok: false,
      message: err.message || 'Could not save settlement',
      code: err.code,
    });
  }
}
