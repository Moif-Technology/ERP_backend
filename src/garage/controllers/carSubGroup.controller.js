import { pool } from '../../config/db.js';
import * as service from '../services/carSubGroup.service.js';

export async function listCarSubGroups(req, res) {
  try {
    const carSubGroups = await service.listCarSubGroups(pool, req.authStaff, req.query.groupId);
    return res.json({ carSubGroups });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load car sub groups' });
  }
}

export async function createCarSubGroup(req, res) {
  try {
    const created = await service.createCarSubGroup(pool, req.body, req.authStaff);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') {
      return res.status(409).json({ message: 'A car sub group with this name already exists in this group' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not create car sub group' });
  }
}

export async function deleteCarSubGroup(req, res) {
  try {
    await service.deleteCarSubGroup(pool, req.authStaff, req.params.carSubGroupId);
    return res.status(204).end();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not delete car sub group' });
  }
}
