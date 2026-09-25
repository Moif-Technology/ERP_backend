import { pool } from '../../../config/db.js';
import * as inventoryReportService from '../services/inventoryReport.service.js';

function handleError(res, err, fallback) {
  if (err.status) {
    return res.status(err.status).json({ ok: false, message: err.message });
  }
  if (err.code === '42P01') {
    return res.status(503).json({ ok: false, message: 'Inventory tables not installed.' });
  }
  if (err.code === '42703') {
    return res.status(503).json({ ok: false, message: 'Database migration required (missing column).' });
  }
  console.error('[pos inventory report]', err);
  return res.status(500).json({ ok: false, message: err.message || fallback });
}

/** GET /api/pos/inventory/lookups — brands, suppliers, locations for RptInventoryfrm. */
export async function lookups(req, res) {
  try {
    const data = await inventoryReportService.loadLookups(pool, req.authStaff, req.query ?? {});
    return res.status(200).json({ ok: true, ...data });
  } catch (err) {
    return handleError(res, err, 'Could not load inventory lookups');
  }
}

/** GET /api/pos/inventory/report — btnReport_Click + ProductInventory.rpt rows. */
export async function report(req, res) {
  try {
    const out = await inventoryReportService.buildInventoryReport(
      pool,
      req.query ?? {},
      req.authStaff,
    );
    return res.status(200).json(out);
  } catch (err) {
    return handleError(res, err, 'Could not load stock report');
  }
}

/** GET /api/pos/inventory/movement — RptProductMovementRpt from product_log_entry. */
export async function movement(req, res) {
  try {
    const out = await inventoryReportService.buildMovementReport(
      pool,
      req.query ?? {},
      req.authStaff,
    );
    return res.status(200).json(out);
  } catch (err) {
    return handleError(res, err, 'Could not load movement report');
  }
}
