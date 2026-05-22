import { pool } from '../../config/db.js';
import * as service from '../../services/garage/consumable.service.js';

export async function listConsumables(req, res) {
  try { return res.json({ consumables: await service.listConsumables(pool, req.query, req.authStaff) }); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not load consumables' }); }
}
export async function getConsumableById(req, res) {
  try { return res.json(await service.getConsumableById(pool, req.params.id, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not load consumable' }); }
}
export async function createConsumable(req, res) {
  try { return res.status(201).json(await service.createConsumable(pool, req.body, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not create consumable' }); }
}
export async function updateConsumable(req, res) {
  try { return res.json(await service.updateConsumable(pool, req.params.id, req.body, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not update consumable' }); }
}
export async function deleteConsumable(req, res) {
  try { await service.deleteConsumable(pool, req.params.id, req.authStaff); return res.json({ message: 'Deleted' }); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not delete consumable' }); }
}
