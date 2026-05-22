import { pool } from '../config/db.js';
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
    return res.status(500).json({ message: 'Could not save purchase' });
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
