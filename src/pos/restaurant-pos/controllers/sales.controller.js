import { pool } from '../../../config/db.js';
import * as salesService from '../services/sales.service.js';
import * as salesRepo from '../repositories/sales.repository.js';

/**
 * GET /api/pos/sales/next-bill-no — the number the next settle will assign.
 *
 * Deliberately NOT counter-pos's version: that one takes MAX(bill_no) across the
 * whole company, while restaurant settle numbers per station
 * (repositories/sales.repository.js nextBillNo). On a two-till restaurant the
 * counter-pos number would preview a bill number settle never assigns.
 */
export async function nextBillNo(req, res) {
  try {
    const companyId = Number(req.authStaff.company_id);
    const stationId = Number(req.authStaff.station_id ?? req.authStaff.branch_id);
    const billNo = await salesRepo.nextBillNo(pool, companyId, stationId);
    return res.json({ billNo, billNoDisplay: `B-${billNo}` });
  } catch (err) {
    console.error('[sales] next-bill-no failed', err);
    return res.status(500).json({ message: 'Failed to get next bill number' });
  }
}

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
