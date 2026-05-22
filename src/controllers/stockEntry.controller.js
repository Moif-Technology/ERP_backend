import * as service from '../services/stockEntry.service.js';
import { pool } from '../config/db.js';

function handleErr(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.code === '42P01') return res.status(503).json({ message: 'Stock tables not installed — run migration 040.' });
  console.error(err);
  return res.status(500).json({ message: fallback });
}

export async function saveEntry(req, res) {
  try {
    const result = await service.saveEntry(pool, req.body, req.authStaff);
    return res.status(201).json(result);
  } catch (err) {
    return handleErr(res, err, 'Could not save stock entry');
  }
}

export async function getEntry(req, res) {
  try {
    const entry = await service.getEntry(pool, req.params.id, req.authStaff);
    return res.json({ entry });
  } catch (err) {
    return handleErr(res, err, 'Could not load stock entry');
  }
}

export async function listEntries(req, res) {
  try {
    const { docType = 'ADJ' } = req.query;
    const entries = await service.listEntries(pool, docType, req.authStaff);
    return res.json({ entries });
  } catch (err) {
    return handleErr(res, err, 'Could not list stock entries');
  }
}

export async function postEntry(req, res) {
  try {
    const result = await service.postEntry(pool, req.params.id, req.authStaff);
    return res.json(result);
  } catch (err) {
    return handleErr(res, err, 'Could not post stock entry');
  }
}

export async function unpostEntry(req, res) {
  try {
    const result = await service.unpostEntry(pool, req.params.id, req.authStaff);
    return res.json(result);
  } catch (err) {
    return handleErr(res, err, 'Could not unpost stock entry');
  }
}

export async function deleteEntry(req, res) {
  try {
    await service.deleteEntry(pool, req.params.id, req.authStaff);
    return res.json({ deleted: true });
  } catch (err) {
    return handleErr(res, err, 'Could not delete stock entry');
  }
}

export async function getReorderList(req, res) {
  try {
    const items = await service.getReorderList(pool, req.authStaff);
    return res.json({ items });
  } catch (err) {
    return handleErr(res, err, 'Could not load reorder list');
  }
}

export async function getDraftEnteredQty(req, res) {
  try {
    const row = await service.getDraftEnteredQty(pool, req.query, req.authStaff);
    return res.json({ row });
  } catch (err) {
    return handleErr(res, err, 'Could not load draft entered quantity');
  }
}

export async function getProductMovement(req, res) {
  try {
    const rows = await service.getProductMovement(pool, req.query, req.authStaff);
    return res.json({ rows });
  } catch (err) {
    return handleErr(res, err, 'Could not load product movement');
  }
}
