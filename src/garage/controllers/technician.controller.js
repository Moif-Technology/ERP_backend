import { pool } from '../../config/db.js';
import * as service from '../services/technician.service.js';

export async function listTechnicians(req, res) {
  try {
    return res.json({ technicians: await service.listTechnicians(pool, req.query, req.authStaff) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load technicians' });
  }
}

export async function getTechnicianById(req, res) {
  try {
    return res.json(await service.getTechnicianById(pool, req.params.id, req.authStaff));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load technician' });
  }
}

export async function createTechnician(req, res) {
  try {
    return res.status(201).json(await service.createTechnician(pool, req.body, req.authStaff));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not create technician' });
  }
}

export async function updateTechnician(req, res) {
  try {
    return res.json(await service.updateTechnician(pool, req.params.id, req.body, req.authStaff));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not update technician' });
  }
}

export async function deleteTechnician(req, res) {
  try {
    await service.deleteTechnician(pool, req.params.id, req.authStaff);
    return res.json({ message: 'Technician deactivated' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not delete technician' });
  }
}
