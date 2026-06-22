import { pool } from '../../config/db.js';
import * as purchaseEntryService from '../services/purchaseEntry.service.js';

export async function createPurchase(req, res) {
  try {
    const result = await purchaseEntryService.createPurchase(pool, req.body, req.authStaff);
    return res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '42P01' || err.code === '23503') {
      return res.status(503).json({
        message:
          err.code === '23503'
            ? 'Related master row missing. Run migrations and ensure supplier, branch, and products exist.'
            : 'Purchase tables not installed. Run database migrations.',
      });
    }
    console.error(err);
    const detail = err.message && !err.status ? err.message : null;
    return res.status(500).json({
      message: detail && detail.length < 200 ? detail : 'Could not save purchase',
    });
  }
}

export async function listPurchases(req, res) {
  try {
    const rows = await purchaseEntryService.listPurchases(pool, req.authStaff, req.query);
    return res.json({ purchases: rows });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'Purchase tables not installed. Run database/migrations/036_ops_purchase_and_supplier_master.sql' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not list purchases' });
  }
}

export async function lookupPurchase(req, res) {
  try {
    const data = await purchaseEntryService.lookupPurchase(pool, req.authStaff, req.query);
    return res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not lookup purchase' });
  }
}

export async function getPurchase(req, res) {
  try {
    const data = await purchaseEntryService.getPurchase(
      pool,
      req.authStaff,
      req.params.purchaseId,
      req.query,
    );
    return res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load purchase' });
  }
}

export async function getPurchaseAccounts(req, res) {
  try {
    const data = await purchaseEntryService.getPurchaseAccounts(
      pool,
      req.authStaff,
      req.params.purchaseId,
      req.query,
    );
    return res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load purchase accounts' });
  }
}

export async function previewPurchaseAccounts(req, res) {
  try {
    const data = await purchaseEntryService.previewPurchaseAccounts(
      pool,
      req.authStaff,
      req.params.purchaseId,
      req.body,
      req.query,
    );
    return res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not preview purchase accounts' });
  }
}

export async function updatePurchase(req, res) {
  try {
    const result = await purchaseEntryService.updatePurchase(
      pool,
      req.body,
      req.authStaff,
      req.params.purchaseId,
    );
    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: err.message || 'Could not update purchase' });
  }
}

export async function postPurchase(req, res) {
  try {
    const result = await purchaseEntryService.postPurchase(
      pool,
      req.authStaff,
      req.params.purchaseId,
      req.query,
      req.body,
    );
    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: err.message || 'Could not post purchase' });
  }
}

export async function unpostPurchase(req, res) {
  try {
    const result = await purchaseEntryService.unpostPurchase(
      pool,
      req.authStaff,
      req.params.purchaseId,
      req.query,
    );
    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: err.message || 'Could not unpost purchase' });
  }
}
