import { pool } from '../../config/db.js';
import * as service from '../services/vehicleMaster.service.js';

export async function listVehicles(req, res) {
  try {
    const vehicles = await service.listVehicles(pool, req.query, req.authStaff);
    return res.json({ vehicles });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load vehicles' });
  }
}

export async function getVehicleById(req, res) {
  try {
    const vehicle = await service.getVehicleById(pool, req.params.id, req.authStaff);
    return res.json(vehicle);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load vehicle' });
  }
}

export async function createVehicle(req, res) {
  try {
    const created = await service.createVehicle(pool, req.body, req.authStaff);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Vehicle already exists with the same registration, chassis, or engine number' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not create vehicle' });
  }
}

export async function updateVehicle(req, res) {
  try {
    const updated = await service.updateVehicle(pool, req.params.id, req.body, req.authStaff);
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Vehicle already exists with the same registration, chassis, or engine number' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not update vehicle' });
  }
}
