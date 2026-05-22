import { pool } from '../../config/db.js';
import * as service from '../../services/garage/estimation.service.js';

export async function listEstimations(req, res) {
  try {
    const items = await service.listEstimations(pool, req.query, req.authStaff);
    return res.json({ estimations: items });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load estimations' });
  }
}

export async function getEstimationById(req, res) {
  try {
    const item = await service.getEstimationById(pool, req.params.id, req.authStaff);
    return res.json(item);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load estimation' });
  }
}

export async function createEstimation(req, res) {
  try {
    const created = await service.createEstimation(pool, req.body, req.authStaff);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') return res.status(409).json({ message: 'Duplicate estimation number' });
    console.error(err);
    return res.status(500).json({ message: 'Could not create estimation' });
  }
}

export async function updateEstimation(req, res) {
  try {
    const updated = await service.updateEstimation(pool, req.params.id, req.body, req.authStaff);
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not update estimation' });
  }
}

export async function postEstimation(req, res) {
  try {
    const updated = await service.postEstimation(pool, req.params.id, req.authStaff);
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not post estimation' });
  }
}

export async function unpostEstimation(req, res) {
  try {
    const updated = await service.unpostEstimation(pool, req.params.id, req.authStaff);
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not unpost estimation' });
  }
}
