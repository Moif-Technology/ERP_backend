import { pool } from '../../config/db.js';
import * as salesReturnEntryService from '../services/salesReturnEntry.service.js';

export async function previewDraftSalesReturnAccounts(req, res) {
  try {
    return res.json(await salesReturnEntryService.previewDraftSalesReturnAccounts(
      pool, req.authStaff, req.body, req.query,
    ));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: err.message || 'Could not preview return accounts' });
  }
}

export async function loadSourceSale(req, res) {
  try {
    return res.json(await salesReturnEntryService.loadSourceSale(pool, req.authStaff, req.query));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load sales bill' });
  }
}

export async function listSalesReturns(req, res) {
  try {
    const rows = await salesReturnEntryService.listSalesReturns(pool, req.authStaff, req.query);
    return res.json({ returns: rows });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not list sales returns' });
  }
}

export async function lookupSalesReturn(req, res) {
  try {
    return res.json(await salesReturnEntryService.lookupSalesReturn(pool, req.authStaff, req.query));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not lookup sales return' });
  }
}

export async function getSalesReturn(req, res) {
  try {
    return res.json(await salesReturnEntryService.getSalesReturn(
      pool, req.authStaff, req.params.salesId, req.query,
    ));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load sales return' });
  }
}

export async function createSalesReturn(req, res) {
  try {
    const result = await salesReturnEntryService.createSalesReturn(pool, req.body, req.authStaff);
    return res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: err.message || 'Could not save sales return' });
  }
}

export async function updateSalesReturn(req, res) {
  try {
    return res.json(await salesReturnEntryService.updateSalesReturn(
      pool, req.body, req.authStaff, req.params.salesId,
    ));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: err.message || 'Could not update sales return' });
  }
}

export async function postSalesReturn(req, res) {
  try {
    return res.json(await salesReturnEntryService.postSalesReturn(
      pool, req.authStaff, req.params.salesId, req.query,
    ));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: err.message || 'Could not post sales return' });
  }
}

export async function unpostSalesReturn(req, res) {
  try {
    return res.json(await salesReturnEntryService.unpostSalesReturn(
      pool, req.authStaff, req.params.salesId, req.query,
    ));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: err.message || 'Could not unpost sales return' });
  }
}

export async function getSalesReturnAccounts(req, res) {
  try {
    return res.json(await salesReturnEntryService.getSalesReturnAccounts(
      pool, req.authStaff, req.params.salesId, req.query,
    ));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load return accounts' });
  }
}

export async function previewSalesReturnAccounts(req, res) {
  try {
    return res.json(await salesReturnEntryService.previewSalesReturnAccounts(
      pool, req.authStaff, req.params.salesId, req.body, req.query,
    ));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: err.message || 'Could not preview return accounts' });
  }
}
