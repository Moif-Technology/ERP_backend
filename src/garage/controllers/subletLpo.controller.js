import { pool } from '../../config/db.js';
import * as service from '../services/subletLpo.service.js';

export async function listSubletLpos(req, res) {
  try { return res.json({ subletLpos: await service.listSubletLpos(pool, req.query, req.authStaff) }); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not load sublet LPOs' }); }
}

export async function getSubletLpoById(req, res) {
  try { return res.json(await service.getSubletLpoById(pool, req.params.id, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not load sublet LPO' }); }
}

export async function createSubletLpo(req, res) {
  try { return res.status(201).json(await service.createSubletLpo(pool, req.body, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not create sublet LPO' }); }
}

export async function updateSubletLpo(req, res) {
  try { return res.json(await service.updateSubletLpo(pool, req.params.id, req.body, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not update sublet LPO' }); }
}

export async function postSubletLpo(req, res) {
  try { return res.json(await service.postSubletLpo(pool, req.params.id, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not post sublet LPO' }); }
}
