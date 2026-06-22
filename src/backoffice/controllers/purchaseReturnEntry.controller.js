import { pool } from '../../config/db.js';
import * as purchaseReturnEntryService from '../services/purchaseReturnEntry.service.js';

export async function previewDraftPurchaseReturnAccounts(req, res) {
  try {
    return res.json(await purchaseReturnEntryService.previewDraftPurchaseReturnAccounts(
      pool, req.authStaff, req.body, req.query,
    ));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: err.message || 'Could not preview return accounts' });
  }
}

export async function loadSourcePurchase(req, res) {
  try {
    return res.json(await purchaseReturnEntryService.loadSourcePurchase(pool, req.authStaff, req.query));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load purchase bill' });
  }
}

export async function listPurchaseReturns(req, res) {
  try {
    const rows = await purchaseReturnEntryService.listPurchaseReturns(pool, req.authStaff, req.query);
    return res.json({ returns: rows });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not list purchase returns' });
  }
}

export async function lookupPurchaseReturn(req, res) {
  try {
    return res.json(await purchaseReturnEntryService.lookupPurchaseReturn(pool, req.authStaff, req.query));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not lookup purchase return' });
  }
}

export async function getPurchaseReturn(req, res) {
  try {
    return res.json(await purchaseReturnEntryService.getPurchaseReturn(
      pool, req.authStaff, req.params.purchaseId, req.query,
    ));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load purchase return' });
  }
}

export async function createPurchaseReturn(req, res) {
  try {
    const result = await purchaseReturnEntryService.createPurchaseReturn(pool, req.body, req.authStaff);
    return res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: err.message || 'Could not save purchase return' });
  }
}

export async function updatePurchaseReturn(req, res) {
  try {
    return res.json(await purchaseReturnEntryService.updatePurchaseReturn(
      pool, req.body, req.authStaff, req.params.purchaseId,
    ));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: err.message || 'Could not update purchase return' });
  }
}

export async function postPurchaseReturn(req, res) {
  try {
    return res.json(await purchaseReturnEntryService.postPurchaseReturn(
      pool, req.authStaff, req.params.purchaseId, req.query,
    ));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: err.message || 'Could not post purchase return' });
  }
}

export async function unpostPurchaseReturn(req, res) {
  try {
    return res.json(await purchaseReturnEntryService.unpostPurchaseReturn(
      pool, req.authStaff, req.params.purchaseId, req.query,
    ));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: err.message || 'Could not unpost purchase return' });
  }
}

export async function getPurchaseReturnAccounts(req, res) {
  try {
    return res.json(await purchaseReturnEntryService.getPurchaseReturnAccounts(
      pool, req.authStaff, req.params.purchaseId, req.query,
    ));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load return accounts' });
  }
}

export async function previewPurchaseReturnAccounts(req, res) {
  try {
    return res.json(await purchaseReturnEntryService.previewPurchaseReturnAccounts(
      pool, req.authStaff, req.params.purchaseId, req.body, req.query,
    ));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not preview return accounts' });
  }
}
