import { pool } from '../../config/db.js';
import * as service from '../services/colorMaster.service.js';

export async function listColors(req, res) {
  try {
    const colors = await service.listColors(pool, req.authStaff);
    return res.json({ colors });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load colors' });
  }
}

export async function createColor(req, res) {
  try {
    const created = await service.createColor(pool, req.body, req.authStaff);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') {
      return res.status(409).json({ message: 'A color with this name already exists' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not create color' });
  }
}

export async function deleteColor(req, res) {
  try {
    await service.deleteColor(pool, req.authStaff, req.params.colorId);
    return res.status(204).end();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not delete color' });
  }
}
