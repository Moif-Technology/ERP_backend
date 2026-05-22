import { pool } from '../../config/db.js';
import * as service from '../../services/garage/carGroup.service.js';

export async function listCarGroups(req, res) {
  try {
    const carGroups = await service.listCarGroups(pool, req.authStaff);
    return res.json({ carGroups });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load car groups' });
  }
}

export async function createCarGroup(req, res) {
  try {
    const created = await service.createCarGroup(pool, req.body, req.authStaff);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') {
      return res.status(409).json({ message: 'A car group with this name already exists' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not create car group' });
  }
}

export async function deleteCarGroup(req, res) {
  try {
    await service.deleteCarGroup(pool, req.authStaff, req.params.carGroupId);
    return res.status(204).end();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not delete car group' });
  }
}
