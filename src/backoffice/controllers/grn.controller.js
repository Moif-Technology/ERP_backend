import { pool } from '../../config/db.js';
import * as grnService from '../services/grn.service.js';

export async function listGrns(req, res) {
  try {
    const rows = await grnService.listGrns(pool, req.authStaff, req.query);
    return res.json({ grns: rows });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'GRN tables not installed. Run database/migrations/038_ops_lpo_grn_and_purchase_refs.sql' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not list GRNs' });
  }
}

export async function getGrn(req, res) {
  try {
    const result = await grnService.getGrn(pool, req.authStaff, req.params.grnId);
    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'GRN tables not installed.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load GRN' });
  }
}

export async function createGrn(req, res) {
  try {
    const result = await grnService.createGrn(pool, req.body, req.authStaff);
    return res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'GRN tables not installed. Run database/migrations/038_ops_lpo_grn_and_purchase_refs.sql' });
    }
    if (err.code === '42703') {
      return res.status(503).json({ message: 'GRN schema is outdated or incompatible with the API.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not save GRN' });
  }
}
