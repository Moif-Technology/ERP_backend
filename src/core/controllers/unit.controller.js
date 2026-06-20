import { pool } from '../../config/db.js';
import * as unitService from '../services/unit.service.js';

export async function listUnits(req, res) {
  try {
    const units = await unitService.listUnits(pool, req.authStaff);
    return res.json({ units });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load units' });
  }
}

export async function createUnit(req, res) {
  try {
    const unit = await unitService.createUnit(pool, req.body, req.authStaff);
    return res.status(201).json(unit);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not create unit' });
  }
}

export async function updateUnit(req, res) {
  try {
    const unit = await unitService.updateUnit(pool, req.params.unitId, req.body, req.authStaff);
    return res.json(unit);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not update unit' });
  }
}

export async function deleteUnit(req, res) {
  try {
    const result = await unitService.deleteUnit(pool, req.params.unitId, req.authStaff);
    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not delete unit' });
  }
}
