import { pool } from '../../config/db.js';
import * as service from '../services/punching.service.js';

export async function listPunchings(req, res) {
  try {
    return res.json({ punchings: await service.listPunchings(pool, req.query, req.authStaff) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err); return res.status(500).json({ message: 'Could not load punchings' });
  }
}

export async function getPunchingById(req, res) {
  try {
    return res.json(await service.getPunchingById(pool, req.params.id, req.authStaff));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err); return res.status(500).json({ message: 'Could not load punching' });
  }
}

export async function getPunchingsByJobCard(req, res) {
  try {
    return res.json({ punchings: await service.getPunchingsByJobCard(pool, req.params.jcNo, req.authStaff) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err); return res.status(500).json({ message: 'Could not load punchings' });
  }
}

export async function createPunching(req, res) {
  try {
    return res.status(201).json(await service.createPunching(pool, req.body, req.authStaff));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err); return res.status(500).json({ message: 'Could not create punching' });
  }
}

export async function updatePunching(req, res) {
  try {
    return res.json(await service.updatePunching(pool, req.params.id, req.body, req.authStaff));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err); return res.status(500).json({ message: 'Could not update punching' });
  }
}

export async function cancelPunching(req, res) {
  try {
    await service.cancelPunching(pool, req.params.id, req.authStaff);
    return res.json({ message: 'Punching cancelled' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err); return res.status(500).json({ message: 'Could not cancel punching' });
  }
}
