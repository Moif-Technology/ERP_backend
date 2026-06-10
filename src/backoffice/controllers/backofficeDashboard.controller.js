import { pool } from '../../config/db.js';
import * as service from '../services/backofficeDashboard.service.js';
import * as unifiedService from '../services/unifiedDashboard.service.js';

export async function getBackofficeDashboard(req, res) {
  try {
    const dashboard = await service.getBackofficeDashboard(pool, req.authStaff);
    return res.json({ dashboard });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load dashboard' });
  }
}

export async function getUnifiedDashboard(req, res) {
  try {
    const dashboard = await unifiedService.getUnifiedDashboard(req.authStaff, req.query);
    return res.json({ dashboard });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load dashboard' });
  }
}
