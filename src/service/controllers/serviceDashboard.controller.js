import { pool } from '../../config/db.js';
import * as svc from '../services/serviceDashboard.service.js';

function handleError(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.code === '42P01') return res.status(503).json({ message: 'Service module tables not installed. Run migration 102_service_case_management.sql.' });
  console.error(err);
  return res.status(500).json({ message: fallback });
}

export async function getDashboard(req, res) {
  try { return res.json(await svc.getDashboard(pool, req.authStaff)); }
  catch (err) { return handleError(res, err, 'Could not load dashboard'); }
}

export async function getExpiryBuckets(req, res) {
  try { return res.json(await svc.getExpiryBuckets(pool, req.authStaff)); }
  catch (err) { return handleError(res, err, 'Could not load expiry data'); }
}
