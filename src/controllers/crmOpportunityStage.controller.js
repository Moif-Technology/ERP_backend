import { pool } from '../config/db.js';
import * as svc from '../services/crmOpportunityStage.service.js';

function handleError(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.code === '23505') return res.status(409).json({ message: 'Duplicate opportunity stage code or name', constraint: err.constraint });
  if (err.code === '42P01') return res.status(503).json({ message: 'CRM tables not installed. Run migration 043_biz_crm_module.sql.' });
  console.error(err);
  return res.status(500).json({ message: fallback });
}

export async function list(req, res) {
  try { return res.json({ items: await svc.list(pool, req.authStaff) }); }
  catch (err) { return handleError(res, err, 'Could not load opportunity stages'); }
}

export async function create(req, res) {
  try { return res.status(201).json(await svc.create(pool, req.body, req.authStaff)); }
  catch (err) { return handleError(res, err, 'Could not create opportunity stage'); }
}

export async function update(req, res) {
  try { return res.json(await svc.update(pool, req.params.id, req.body, req.authStaff)); }
  catch (err) { return handleError(res, err, 'Could not update opportunity stage'); }
}

export async function remove(req, res) {
  try { return res.json(await svc.remove(pool, req.params.id, req.authStaff)); }
  catch (err) { return handleError(res, err, 'Could not delete opportunity stage'); }
}
