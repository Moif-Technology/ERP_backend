import * as service from '../services/stockTransfer.service.js';
import { pool } from '../../config/db.js';

function handleErr(res, err, fallback) {
  if (err.status) {
    return res.status(err.status).json({
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.shortages ? { shortages: err.shortages } : {}),
    });
  }
  if (err.code === '42P01' || err.code === '42703') {
    return res.status(503).json({ message: 'Stock transfer tables not installed — run migration 135.' });
  }
  console.error(err);
  return res.status(500).json({ message: fallback });
}

export async function listTransfers(req, res) {
  try {
    const transfers = await service.listTransfers(pool, req.query, req.authStaff);
    return res.json({ transfers });
  } catch (err) {
    return handleErr(res, err, 'Could not list stock transfers');
  }
}

export async function getStockAtBranch(req, res) {
  try {
    const row = await service.getStockAtBranch(pool, req.query, req.authStaff);
    return res.json(row);
  } catch (err) {
    return handleErr(res, err, 'Could not load stock');
  }
}

export async function getTransfer(req, res) {
  try {
    const result = await service.getTransfer(pool, req.params.id, req.authStaff);
    return res.json(result);
  } catch (err) {
    return handleErr(res, err, 'Could not load stock transfer');
  }
}

export async function createTransfer(req, res) {
  try {
    const result = await service.createTransfer(pool, req.body, req.authStaff);
    return res.status(201).json(result);
  } catch (err) {
    return handleErr(res, err, 'Could not save stock transfer');
  }
}

export async function updateTransfer(req, res) {
  try {
    const result = await service.updateTransfer(pool, req.params.id, req.body, req.authStaff);
    return res.json(result);
  } catch (err) {
    return handleErr(res, err, 'Could not update stock transfer');
  }
}

export async function postTransfer(req, res) {
  try {
    const result = await service.postTransfer(pool, req.params.id, req.authStaff);
    return res.json(result);
  } catch (err) {
    return handleErr(res, err, 'Could not post stock transfer');
  }
}

export async function cancelTransfer(req, res) {
  try {
    const result = await service.cancelTransfer(pool, req.params.id, req.body, req.authStaff);
    return res.json(result);
  } catch (err) {
    return handleErr(res, err, 'Could not cancel stock transfer');
  }
}
