import { pool } from '../config/db.js';
import * as areaService from '../services/area.service.js';

export async function listAreas(req, res) {
  try {
    const areas = await areaService.listAreas(pool, req.authStaff, req.query.branchId);
    return res.json({ areas });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load areas' });
  }
}

export async function createArea(req, res) {
  try {
    const created = await areaService.createArea(pool, req.body, req.authStaff);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    if (err.code === '23505') {
      const c = String(err.constraint || '');
      const looksName =
        c.includes('area_name') || c.includes('company_branch_area_name');
      return res.status(409).json({
        message: looksName
          ? 'An area with this name already exists for this company and branch'
          : 'Duplicate area row.',
        constraint: c || undefined,
      });
    }
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'Area table not installed. Run database migrations.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not create area' });
  }
}
