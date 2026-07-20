import { pool } from '../../config/db.js';
import * as svc from '../services/category.service.js';

function handleError(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.code === '23505') return res.status(409).json({ message: 'Duplicate category', constraint: err.constraint });
  if (err.code === '42P01') return res.status(503).json({ message: 'Service module tables not installed. Run migration 102_service_case_management.sql.' });
  console.error(err);
  return res.status(500).json({ message: fallback });
}

export async function list(req, res) {
  try { return res.json({ items: await svc.list(pool, req.authStaff) }); }
  catch (err) { return handleError(res, err, 'Could not load categories'); }
}

export async function getById(req, res) {
  try { return res.json(await svc.getById(pool, req.params.id, req.authStaff)); }
  catch (err) { return handleError(res, err, 'Could not load category'); }
}

export async function create(req, res) {
  try { return res.status(201).json(await svc.create(pool, req.body, req.authStaff)); }
  catch (err) { return handleError(res, err, 'Could not create category'); }
}

export async function update(req, res) {
  try { return res.json(await svc.update(pool, req.params.id, req.body, req.authStaff)); }
  catch (err) { return handleError(res, err, 'Could not update category'); }
}

export async function remove(req, res) {
  try { return res.json(await svc.remove(pool, req.params.id, req.authStaff)); }
  catch (err) { return handleError(res, err, 'Could not delete category'); }
}
