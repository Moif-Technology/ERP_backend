import { pool } from '../../config/db.js';
import * as saleEntryService from '../services/saleEntry.service.js';

export async function getSaleById(req, res) {
  try {
    const sale = await saleEntryService.getSale(pool, req.authStaff, req.params.salesId, req.query.branchId);
    return res.json({ sale });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '42P01') return res.status(503).json({ message: 'Sales tables not installed.' });
    console.error(err);
    return res.status(500).json({ message: 'Could not load sale' });
  }
}

export async function listSales(req, res) {
  try {
    const rows = await saleEntryService.listSales(pool, req.authStaff, req.query);
    return res.json({ sales: rows });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'Sales tables not installed.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not list sales' });
  }
}

export async function createSale(req, res) {
  try {
    const result = await saleEntryService.createSale(pool, req.body, req.authStaff);
    return res.status(201).json(result);
  } catch (err) {
    if (err.status) {
      const body = { message: err.message };
      if (err.requiresOverride) {
        body.requiresOverride = true;
        body.warnings = err.warnings || [];
      }
      return res.status(err.status).json(body);
    }
    if (err.code === '42P01' || err.code === '23503') {
      return res.status(503).json({
        message:
          err.code === '42P01'
            ? 'Sales tables not installed or incomplete. Ensure ops.sales_master / sales_child exist (see MOIFONE migrations).'
            : 'Invalid reference (branch, customer, or product).',
      });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not save sale' });
  }
}
