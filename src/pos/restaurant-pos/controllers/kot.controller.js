import { pool } from '../../../config/db.js';
import * as kotService from '../services/kot.service.js';

export async function saveKot(req, res) {
  try {
    const out = await kotService.saveKot(pool, req.body, req.authStaff, req.access);
    return res.status(200).json(out);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, message: err.message });
    if (err.code === '42P01') {
      return res.status(503).json({
        ok: false,
        message: 'KOT tables not installed. Run migration 016_ops_kot_master_child.sql.',
      });
    }
    if (err.code === '42703') {
      console.error('[saveKot] missing column:', err.message);
      return res.status(503).json({
        ok: false,
        message: `KOT table is missing a column (${err.message}).`,
      });
    }
    if (err.code === '23502') {
      console.error('[kot save] NOT NULL', err.message, err.column);
      return res.status(503).json({ ok: false, message: err.message });
    }
    console.error('[saveKot] Error:', err.message, 'Code:', err.code, 'Detail:', err.detail);
    return res.status(500).json({ ok: false, message: `Could not save KOT: ${err.message}` });
  }
}

export async function listKots(req, res) {
  try {
    const out = await kotService.listKots(pool, req.authStaff, req.query);
    return res.json(out);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, message: err.message });
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Could not list KOTs' });
  }
}

export async function getKot(req, res) {
  try {
    const kotDetails = await kotService.getKot(pool, req.authStaff, req.params.kotMasterId);
    return res.json(kotDetails);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '42703') {
      return res.status(503).json({
        message:
          'KOT table is missing columns. Run database/migrations/017_ops_kot_audit_columns.sql.',
      });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load KOT' });
  }
}

function kotActionError(res, err, fallback) {
  if (err.status) {
    return res.status(err.status).json({ ok: false, code: err.code ?? null, message: err.message });
  }
  if (err.code === '42P01') {
    return res.status(503).json({ ok: false, message: 'KOT tables not installed.' });
  }
  console.error('[kot action]', err.message, err.code, err.detail);
  return res.status(500).json({ ok: false, message: fallback });
}

/** POST /api/pos/kot/:kotMasterId/cancel — btnBillCancel_Click */
export async function cancelKot(req, res) {
  try {
    const out = await kotService.cancelKot(pool, req.authStaff, req.params.kotMasterId, req.body);
    return res.json(out);
  } catch (err) {
    return kotActionError(res, err, 'Unable To Cancel KOT');
  }
}

/** POST /api/pos/kot/:kotMasterId/items/cancel — ItemRemovefrm.btnremove_Click */
export async function cancelKotItems(req, res) {
  try {
    const out = await kotService.cancelKotItems(
      pool,
      req.authStaff,
      req.params.kotMasterId,
      req.body,
    );
    return res.json(out);
  } catch (err) {
    return kotActionError(res, err, 'Unable To Cancel Item');
  }
}

/** POST /api/pos/kot/:kotMasterId/items/qty — ItemRemovefrm.btnDone_Click */
export async function updateKotItemQty(req, res) {
  try {
    const out = await kotService.updateKotItemQty(
      pool,
      req.authStaff,
      req.params.kotMasterId,
      req.body,
    );
    return res.json(out);
  } catch (err) {
    return kotActionError(res, err, 'Unable To Change Qty');
  }
}

/** POST /api/pos/kot/:kotMasterId/covers — ItemRemovefrm.btnNoOfCust_Click */
export async function updateKotCovers(req, res) {
  try {
    const out = await kotService.updateKotCovers(
      pool,
      req.authStaff,
      req.params.kotMasterId,
      req.body,
    );
    return res.json(out);
  } catch (err) {
    return kotActionError(res, err, 'Unable To Update Covers');
  }
}

/** POST /api/pos/kot/:kotMasterId/change-table — TableFloorRuntimeFrmAreaChange.UpdateKotTable */
export async function changeKotTable(req, res) {
  try {
    const out = await kotService.changeKotTable(
      pool,
      req.authStaff,
      req.params.kotMasterId,
      req.body,
    );
    return res.json(out);
  } catch (err) {
    return kotActionError(res, err, 'Transfer failed.');
  }
}

/** POST /api/pos/kot/join — KotJoinFrm.Join_Save_OldStyle */
export async function joinKots(req, res) {
  try {
    const out = await kotService.joinKots(pool, req.authStaff, req.body);
    return res.json(out);
  } catch (err) {
    return kotActionError(res, err, 'JOIN Failed');
  }
}

/** POST /api/pos/kot/split — KotSplitFrm.Split_Save_ToChair1_UsingKOTMasterClass */
export async function splitKot(req, res) {
  try {
    const out = await kotService.splitKot(pool, req.authStaff, req.body);
    return res.json(out);
  } catch (err) {
    return kotActionError(res, err, 'Split failed');
  }
}
