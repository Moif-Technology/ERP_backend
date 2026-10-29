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

function staffPk(auth) {
  const n = Number(auth?.staff_id ?? auth?.id);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/** GET /api/pos/sales/credit-card-types — settlement list, or all rows when ?all=1. */
export async function listCreditCardTypes(req, res) {
  try {
    const companyId = Number(req.authStaff.company_id);
    const includeInactive = req.query.all === '1' || req.query.includeInactive === '1';
    const types = await salesRepo.listCreditCardTypes(pool, companyId, { includeInactive });
    return res.json({ types });
  } catch (err) {
    console.error('[sales] credit-card-types failed', err);
    return res.status(500).json({ message: 'Could not load card types' });
  }
}

/** POST /api/pos/sales/credit-card-types — create. Body may include id to update. */
export async function saveCreditCardType(req, res) {
  try {
    const companyId = Number(req.authStaff.company_id);
    const id = Number(req.params.id ?? req.body?.id ?? 0);
    const row = await salesRepo.saveCreditCardType(pool, {
      companyId,
      id,
      name: req.body?.name ?? req.body?.creditCardName,
      status: req.body?.status,
      staffId: staffPk(req.authStaff),
    });
    if (!row) return res.status(404).json({ message: 'Card type not found' });
    return res.status(id > 0 ? 200 : 201).json(row);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') return res.status(409).json({ message: 'This card type already exists' });
    console.error('[sales] save credit-card-type failed', err);
    return res.status(500).json({ message: 'Could not save card type' });
  }
}

/** GET /api/pos/sales/by-bill/:billNo — LoadSalesData for Return. */
export async function getSaleByBill(req, res) {
  try {
    const out = await salesService.getSaleByBillNo(pool, req.params.billNo, req.query ?? {}, req.authStaff);
    return res.status(200).json(out);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ ok: false, message: err.message });
    }
    if (err.code === '42P01') {
      return res.status(503).json({ ok: false, message: 'Sales tables not installed.' });
    }
    console.error('[sales by-bill]', err);
    return res.status(500).json({ ok: false, message: err.message || 'Could not load bill' });
  }
}

export async function deliveryBoyOrders(req, res) {
  try {
    const out = await salesService.listDeliveryBoyOrders(pool, req.authStaff, req.query ?? {});
    return res.json(out);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, message: err.message });
    console.error('[delivery boy orders]', err);
    return res.status(500).json({ ok: false, message: 'Could not load delivery orders' });
  }
}

export async function deliveryNightSettle(req, res) {
  try {
    const out = await salesService.settleDeliveryBoyNight(pool, req.authStaff, req.body ?? {});
    return res.json(out);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, message: err.message });
    console.error('[delivery night settle]', err);
    return res.status(500).json({ ok: false, message: err.message || 'Could not settle' });
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
      return res.status(err.status).json({ ok: false, code: err.code ?? null, message: err.message });
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

function viewerError(res, err, fallback) {
  if (err.status) {
    return res.status(err.status).json({ ok: false, message: err.message });
  }
  if (err.code === '42P01') {
    return res.status(503).json({ ok: false, message: 'Sales tables not installed.' });
  }
  console.error('[sales viewer]', err);
  return res.status(500).json({ ok: false, message: err.message || fallback });
}

/** GET /api/pos/sales/reports/:kind — area-wise, payment-mode-wise, customer-wise. */
export async function groupedSalesReport(req, res) {
  const map = {
    'area-wise': 'area',
    'payment-mode-wise': 'payment',
    'customer-wise': 'customer',
  };
  try {
    const out = await salesService.groupedSalesReport(
      pool,
      map[req.params.kind],
      req.query ?? {},
      req.authStaff,
    );
    return res.status(200).json(out);
  } catch (err) {
    return viewerError(res, err, 'Could not load report');
  }
}

/** GET /api/pos/sales/viewer — SalesViewerFrm grid. */
export async function salesViewerList(req, res) {
  try {
    const out = await salesService.listSalesViewer(pool, req.query ?? {}, req.authStaff);
    return res.status(200).json(out);
  } catch (err) {
    return viewerError(res, err, 'Could not load sales viewer');
  }
}

/** GET /api/pos/sales/viewer/:salesId — SalesMasterBackOfficeFrm.DisplayRecord. */
export async function salesViewerBill(req, res) {
  try {
    const out = await salesService.getSalesViewerBill(
      pool,
      req.params.salesId,
      req.query ?? {},
      req.authStaff,
    );
    return res.status(200).json(out);
  } catch (err) {
    return viewerError(res, err, 'Could not load bill');
  }
}

/** GET /api/pos/sales/reports/area-wise — RptAreaWise. */
export async function areaWiseReport(req, res) {
  try {
    return res.status(200).json(await salesService.areaWiseReport(pool, req.query ?? {}, req.authStaff));
  } catch (err) {
    return viewerError(res, err, 'Could not load area-wise report');
  }
}
