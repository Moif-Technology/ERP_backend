import { pool } from '../../../config/db.js';
import * as stockEntryService from '../services/stockEntry.service.js';

function handleError(res, err, fallback) {
  if (err.status) {
    return res.status(err.status).json({ ok: false, message: err.message });
  }
  if (err.code === '42P01') {
    return res.status(503).json({
      ok: false,
      message: 'Stock tables not installed. Run stock entry migration.',
    });
  }
  if (err.code === '42703') {
    return res.status(503).json({ ok: false, message: 'Database migration required (missing column).' });
  }
  console.error('[pos stock entry]', err);
  return res.status(500).json({ ok: false, message: err.message || fallback });
}

export async function searchProducts(req, res) {
  try {
    const products = await stockEntryService.searchProducts(pool, req.query ?? {}, req.authStaff);
    return res.status(200).json({ ok: true, products });
  } catch (err) {
    return handleError(res, err, 'Could not search products');
  }
}

export async function draftEnteredQty(req, res) {
  try {
    const row = await stockEntryService.draftEnteredQty(pool, req.query ?? {}, req.authStaff);
    return res.status(200).json({ ok: true, ...row });
  } catch (err) {
    return handleError(res, err, 'Could not load entered qty');
  }
}

export async function listEntries(req, res) {
  try {
    const entries = await stockEntryService.listEntries(pool, req.query ?? {}, req.authStaff);
    return res.status(200).json({ ok: true, entries });
  } catch (err) {
    return handleError(res, err, 'Could not list stock entries');
  }
}

export async function getEntry(req, res) {
  try {
    const entry = await stockEntryService.getEntry(
      pool,
      req.params.id,
      req.query ?? {},
      req.authStaff,
    );
    return res.status(200).json({ ok: true, entry });
  } catch (err) {
    return handleError(res, err, 'Could not load stock entry');
  }
}

export async function saveEntry(req, res) {
  try {
    const out = await stockEntryService.saveEntry(pool, req.body ?? {}, req.authStaff);
    return res.status(200).json({ ok: true, ...out });
  } catch (err) {
    return handleError(res, err, 'Could not save stock entry');
  }
}

export async function postEntry(req, res) {
  try {
    const out = await stockEntryService.postEntry(
      pool,
      req.params.id,
      { ...req.query, ...req.body },
      req.authStaff,
    );
    return res.status(200).json({ ok: true, ...out });
  } catch (err) {
    return handleError(res, err, 'Could not post stock entry');
  }
}

export async function deleteEntry(req, res) {
  try {
    await stockEntryService.deleteEntry(pool, req.params.id, req.query ?? {}, req.authStaff);
    return res.status(200).json({ ok: true, deleted: true });
  } catch (err) {
    return handleError(res, err, 'Could not delete stock entry');
  }
}
