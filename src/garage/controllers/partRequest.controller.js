import { pool } from '../../config/db.js';
import * as service from '../services/partRequest.service.js';

export async function listPartRequests(req, res) {
  try {
    const items = await service.listPartRequests(pool, req.query, req.authStaff);
    return res.json({ partRequests: items });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load part requests' });
  }
}

export async function getPartRequestById(req, res) {
  try {
    const item = await service.getPartRequestById(pool, req.params.id, req.authStaff);
    return res.json(item);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load part request' });
  }
}

export async function createPartRequest(req, res) {
  try {
    const created = await service.createPartRequest(pool, req.body, req.authStaff);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') return res.status(409).json({ message: 'Duplicate request number' });
    console.error(err);
    return res.status(500).json({ message: 'Could not create part request' });
  }
}

export async function updatePartRequest(req, res) {
  try {
    const updated = await service.updatePartRequest(pool, req.params.id, req.body, req.authStaff);
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not update part request' });
  }
}

export async function issuePartRequest(req, res) {
  try {
    const updated = await service.issuePartRequest(pool, req.params.id, req.body, req.authStaff);
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not issue part request' });
  }
}

export async function cancelPartRequest(req, res) {
  try {
    const updated = await service.cancelPartRequest(pool, req.params.id, req.authStaff);
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not cancel part request' });
  }
}
