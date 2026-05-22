import { pool } from '../../config/db.js';
import * as service from '../../services/garage/gatePass.service.js';

export async function listGatePasses(req, res) {
  try { return res.json({ gatePasses: await service.listGatePasses(pool, req.query, req.authStaff) }); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not load gate passes' }); }
}
export async function getGatePassById(req, res) {
  try { return res.json(await service.getGatePassById(pool, req.params.id, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not load gate pass' }); }
}
export async function createGatePass(req, res) {
  try { return res.status(201).json(await service.createGatePass(pool, req.body, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); if (err.code === '23505') return res.status(409).json({ message: 'Gate pass already exists' }); console.error(err); return res.status(500).json({ message: 'Could not create gate pass' }); }
}
