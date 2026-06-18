import { pool } from '../../config/db.js';
import * as locationService from '../services/location.service.js';

function handleErr(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.code === '23505') return res.status(409).json({ message: 'Location code already exists for this branch' });
  if (err.code === '42P01') return res.status(503).json({ message: 'Location table not installed. Run migration 083.' });
  console.error(err);
  return res.status(500).json({ message: fallback });
}

export async function listLocations(req, res) {
  try {
    const locations = await locationService.listLocations(pool, req.authStaff, req.query);
    return res.json({ locations });
  } catch (err) {
    return handleErr(res, err, 'Could not load locations');
  }
}

export async function createLocation(req, res) {
  try {
    const location = await locationService.createLocation(pool, req.body, req.authStaff);
    return res.status(201).json(location);
  } catch (err) {
    return handleErr(res, err, 'Could not create location');
  }
}

export async function updateLocation(req, res) {
  try {
    const location = await locationService.updateLocation(pool, req.params.locationId, req.body, req.authStaff);
    return res.json(location);
  } catch (err) {
    return handleErr(res, err, 'Could not update location');
  }
}

export async function deleteLocation(req, res) {
  try {
    const result = await locationService.deleteLocation(pool, req.params.locationId, req.authStaff);
    return res.json(result);
  } catch (err) {
    return handleErr(res, err, 'Could not delete location');
  }
}
