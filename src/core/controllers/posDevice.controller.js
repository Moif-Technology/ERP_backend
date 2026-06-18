import { pool } from '../../config/db.js';
import * as service from '../services/posDevice.service.js';

function handleError(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: fallback });
}

export async function listDevices(req, res) {
  try {
    const devices = await service.listDevices(pool, req.authStaff);
    return res.json({ devices });
  } catch (err) {
    return handleError(res, err, 'Could not load POS devices');
  }
}

export async function updateDevice(req, res) {
  try {
    const device = await service.updateDevice(pool, req.authStaff, req.params.deviceId, req.body);
    return res.json({ device });
  } catch (err) {
    return handleError(res, err, 'Could not update POS device');
  }
}
