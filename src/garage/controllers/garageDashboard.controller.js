import { pool } from '../../config/db.js';
import * as service from '../services/garageDashboard.service.js';

export async function getDashboardKpis(req, res) {
  try {
    return res.json(await service.getDashboardKpis(pool, req.query, req.authStaff));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load dashboard' });
  }
}
