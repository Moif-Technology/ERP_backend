import { pool } from '../../config/db.js';
import * as lpoService from '../services/lpo.service.js';

export async function listLpos(req, res) {
  try {
    const rows = await lpoService.listLpos(pool, req.authStaff, req.query);
    return res.json({ lpos: rows });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'LPO tables not installed. Run database/migrations/038_ops_lpo_grn_and_purchase_refs.sql' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not list LPOs' });
  }
}

export async function getLpo(req, res) {
  try {
    const result = await lpoService.getLpo(pool, req.authStaff, req.params.lpoMasterId);
    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'LPO tables not installed.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load LPO' });
  }
}

export async function createLpo(req, res) {
  try {
    const result = await lpoService.createLpo(pool, req.body, req.authStaff);
    return res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '42P01' || err.code === '42703') {
      return res.status(503).json({
        message:
          err.code === '42703'
            ? 'LPO schema is outdated. Run database/migrations/039_ops_lpo_detail_columns.sql'
            : 'LPO tables not installed. Run database/migrations/038_ops_lpo_grn_and_purchase_refs.sql',
      });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not save LPO' });
  }
}

export async function updateLpo(req, res) {
  try {
    const result = await lpoService.updateLpo(pool, req.body, req.authStaff, req.params.lpoMasterId);
    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '42P01' || err.code === '42703') {
      return res.status(503).json({
        message:
          err.code === '42703'
            ? 'LPO schema is outdated. Run database/migrations/039_ops_lpo_detail_columns.sql'
            : 'LPO tables not installed.',
      });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not update LPO' });
  }
}
