import { pool } from '../../config/db.js';
import * as floorDesignService from '../services/floorDesign.service.js';

export async function getFloorDesign(req, res) {
  try {
    const design = await floorDesignService.getFloorDesign(pool, req.params.areaId, req.authStaff);
    return res.json(design);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'Floor design tables not installed. Run database migrations.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load floor design' });
  }
}

export async function saveFloorDesign(req, res) {
  try {
    const saved = await floorDesignService.saveFloorDesign(
      pool,
      req.params.areaId,
      req.body,
      req.authStaff,
    );
    return res.json(saved);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'Floor design tables not installed. Run database migrations.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not save floor design' });
  }
}
