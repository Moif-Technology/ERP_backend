import { pool } from '../../config/db.js';
import * as vanService from '../services/vanMaster.service.js';

export async function listVans(req, res) {
  try {
    const vans = await vanService.listVans(pool, req.authStaff);
    return res.json({ vans });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load vans' });
  }
}

export async function createVan(req, res) {
  try {
    const created = await vanService.createVan(pool, req.body, req.authStaff);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') {
      const c = String(err.constraint || '');
      return res.status(409).json({
        message: c.includes('van_code')
          ? 'Van code already exists for this company'
          : 'Duplicate van record',
        constraint: c || undefined,
      });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not create van' });
  }
}

export async function updateVan(req, res) {
  try {
    const updated = await vanService.updateVan(pool, req.params.vanId, req.body, req.authStaff);
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Van code already exists for this company' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not update van' });
  }
}

export async function toggleVan(req, res) {
  try {
    const updated = await vanService.toggleVan(pool, req.params.vanId, req.authStaff);
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not toggle van status' });
  }
}
