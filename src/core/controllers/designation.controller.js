import { pool } from '../../config/db.js';
import * as designationService from '../services/designation.service.js';

function handle(err, res, fallbackMessage) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: fallbackMessage });
}

export async function listDesignations(req, res) {
  try {
    const designations = await designationService.listDesignations(pool, req.authStaff, req.query);
    return res.json({ designations });
  } catch (err) {
    return handle(err, res, 'Could not load designations');
  }
}

export async function createDesignation(req, res) {
  try {
    const designation = await designationService.createDesignation(pool, req.authStaff, req.body);
    return res.status(201).json(designation);
  } catch (err) {
    return handle(err, res, 'Could not create designation');
  }
}

export async function deleteDesignation(req, res) {
  try {
    await designationService.deleteDesignation(pool, req.authStaff, req.params.designationId, req.query);
    return res.json({ message: 'Designation deleted' });
  } catch (err) {
    return handle(err, res, 'Could not delete designation');
  }
}
