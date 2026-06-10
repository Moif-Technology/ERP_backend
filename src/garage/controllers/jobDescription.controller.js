import { pool } from '../../config/db.js';
import * as service from '../services/jobDescription.service.js';

export async function listJobDescriptions(req, res) {
  try {
    return res.json({ jobDescriptions: await service.listJobDescriptions(pool, req.query, req.authStaff) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load job descriptions' });
  }
}

export async function getJobDescriptionById(req, res) {
  try {
    return res.json(await service.getJobDescriptionById(pool, req.params.id, req.authStaff));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load job description' });
  }
}

export async function createJobDescription(req, res) {
  try {
    return res.status(201).json(await service.createJobDescription(pool, req.body, req.authStaff));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') return res.status(409).json({ message: 'Job code already exists' });
    console.error(err);
    return res.status(500).json({ message: 'Could not create job description' });
  }
}

export async function updateJobDescription(req, res) {
  try {
    return res.json(await service.updateJobDescription(pool, req.params.id, req.body, req.authStaff));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') return res.status(409).json({ message: 'Job code already exists' });
    console.error(err);
    return res.status(500).json({ message: 'Could not update job description' });
  }
}

export async function deleteJobDescription(req, res) {
  try {
    await service.deleteJobDescription(pool, req.params.id, req.authStaff);
    return res.json({ message: 'Job description deactivated' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not delete job description' });
  }
}
