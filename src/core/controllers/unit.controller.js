import { pool } from '../../config/db.js';
import * as unitService from '../services/unit.service.js';

export async function listUnits(req, res) {
  try {
    const units = await unitService.listUnits(pool, req.authStaff);
    return res.json({ units });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load units' });
  }
}
