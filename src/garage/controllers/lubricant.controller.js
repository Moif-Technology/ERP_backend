import { pool } from '../../config/db.js';
import * as service from '../services/lubricant.service.js';

export async function listLubricants(req, res) {
  try { return res.json({ lubricants: await service.listLubricants(pool, req.query, req.authStaff) }); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not load lubricants' }); }
}
export async function getLubricantById(req, res) {
  try { return res.json(await service.getLubricantById(pool, req.params.id, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not load lubricant' }); }
}
export async function createLubricant(req, res) {
  try { return res.status(201).json(await service.createLubricant(pool, req.body, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not create lubricant' }); }
}
export async function updateLubricant(req, res) {
  try { return res.json(await service.updateLubricant(pool, req.params.id, req.body, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not update lubricant' }); }
}
export async function deleteLubricant(req, res) {
  try { await service.deleteLubricant(pool, req.params.id, req.authStaff); return res.json({ message: 'Deleted' }); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not delete lubricant' }); }
}
