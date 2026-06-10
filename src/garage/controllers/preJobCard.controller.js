import { pool } from '../../config/db.js';
import * as service from '../services/preJobCard.service.js';

export async function listPreJobCards(req, res) {
  try {
    const items = await service.listPreJobCards(pool, req.query, req.authStaff);
    return res.json({ preJobCards: items });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load pre job cards' });
  }
}

export async function getPreJobCardById(req, res) {
  try {
    const item = await service.getPreJobCardById(pool, req.params.id, req.authStaff);
    return res.json(item);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load pre job card' });
  }
}

export async function searchByRegNo(req, res) {
  try {
    const item = await service.searchByRegNo(pool, req.query, req.authStaff);
    return res.json({ preJobCard: item });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not search pre job card' });
  }
}

export async function createPreJobCard(req, res) {
  try {
    const created = await service.createPreJobCard(pool, req.body, req.authStaff);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') return res.status(409).json({ message: 'Duplicate pre job card entry' });
    console.error(err);
    return res.status(500).json({ message: 'Could not create pre job card' });
  }
}

export async function updatePreJobCard(req, res) {
  try {
    const updated = await service.updatePreJobCard(pool, req.params.id, req.body, req.authStaff);
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not update pre job card' });
  }
}
