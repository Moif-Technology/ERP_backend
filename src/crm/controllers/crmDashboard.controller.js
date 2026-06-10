import { pool } from '../../config/db.js';
import * as svc from '../services/crmDashboard.service.js';

export async function getDashboard(req, res) {
  try {
    return res.json(await svc.getDashboard(pool, req.authStaff));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'CRM tables not installed. Run migration 043_biz_crm_module.sql.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load CRM dashboard' });
  }
}
