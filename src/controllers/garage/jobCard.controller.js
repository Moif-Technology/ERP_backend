import { pool } from '../../config/db.js';
import * as service from '../../services/garage/jobCard.service.js';

export async function listJobCards(req, res) {
  try {
    const items = await service.listJobCards(pool, req.query, req.authStaff);
    return res.json({ jobCards: items });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load job cards' });
  }
}

export async function getJobCardById(req, res) {
  try {
    const item = await service.getJobCardById(pool, req.params.id, req.authStaff);
    return res.json(item);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load job card' });
  }
}

export async function createJobCard(req, res) {
  try {
    const created = await service.createJobCard(pool, req.body, req.authStaff);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') return res.status(409).json({ message: 'Duplicate job card number' });
    console.error(err);
    return res.status(500).json({ message: 'Could not create job card' });
  }
}

export async function updateJobCard(req, res) {
  try {
    const updated = await service.updateJobCard(pool, req.params.id, req.body, req.authStaff);
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not update job card' });
  }
}

export async function postJobCard(req, res) {
  try {
    const updated = await service.postJobCard(pool, req.params.id, req.authStaff);
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not post job card' });
  }
}

export async function unpostJobCard(req, res) {
  try {
    const updated = await service.unpostJobCard(pool, req.params.id, req.authStaff);
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not unpost job card' });
  }
}

export async function transitionJobCard(req, res) {
  try {
    const updated = await service.transitionJobCard(pool, req.params.id, req.body, req.authStaff);
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not update job workflow' });
  }
}

export async function deliverVehicle(req, res) {
  try {
    const updated = await service.deliverVehicle(pool, req.params.id, req.body, req.authStaff);
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not deliver vehicle' });
  }
}

export async function workshopMonitor(req, res) {
  try {
    const data = await service.workshopMonitor(pool, req.query, req.authStaff);
    return res.json({ jobCards: data });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load workshop monitor' });
  }
}
