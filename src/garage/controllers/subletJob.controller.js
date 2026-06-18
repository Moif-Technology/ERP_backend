import { pool } from '../../config/db.js';
import * as service from '../services/subletJob.service.js';

export async function listSubletJobs(req, res) {
  try { return res.json({ subletJobs: await service.listSubletJobs(pool, req.query, req.authStaff) }); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not load sublet jobs' }); }
}

export async function getSubletJobById(req, res) {
  try { return res.json(await service.getSubletJobById(pool, req.params.id, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not load sublet job' }); }
}

export async function createSubletJob(req, res) {
  try { return res.status(201).json(await service.createSubletJob(pool, req.body, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not create sublet job' }); }
}

export async function updateSubletJob(req, res) {
  try { return res.json(await service.updateSubletJob(pool, req.params.id, req.body, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not update sublet job' }); }
}

export async function postSubletJob(req, res) {
  try { return res.json(await service.postSubletJob(pool, req.params.id, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not post sublet job' }); }
}

export async function cancelSubletJob(req, res) {
  try { return res.json(await service.cancelSubletJob(pool, req.params.id, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not cancel sublet job' }); }
}
