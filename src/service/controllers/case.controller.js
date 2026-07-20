import { pool } from '../../config/db.js';
import * as svc from '../services/case.service.js';

function handleError(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.code === '23505') return res.status(409).json({ message: 'Duplicate case', constraint: err.constraint });
  if (err.code === '42P01') return res.status(503).json({ message: 'Service module tables not installed. Run migration 102_service_case_management.sql.' });
  console.error(err);
  return res.status(500).json({ message: fallback });
}

export async function list(req, res) {
  try { return res.json({ items: await svc.list(pool, req.query, req.authStaff) }); }
  catch (err) { return handleError(res, err, 'Could not load cases'); }
}

export async function getById(req, res) {
  try { return res.json(await svc.getById(pool, req.params.id, req.authStaff)); }
  catch (err) { return handleError(res, err, 'Could not load case'); }
}

export async function create(req, res) {
  try { return res.status(201).json(await svc.create(pool, req.body, req.authStaff)); }
  catch (err) { return handleError(res, err, 'Could not create case'); }
}

export async function update(req, res) {
  try { return res.json(await svc.updateFields(pool, req.params.id, req.body, req.authStaff)); }
  catch (err) { return handleError(res, err, 'Could not update case'); }
}

export async function updateStatus(req, res) {
  try { return res.json(await svc.updateStatus(pool, req.params.id, req.body, req.authStaff)); }
  catch (err) { return handleError(res, err, 'Could not update case status'); }
}

export async function listTaskBoard(req, res) {
  try { return res.json({ items: await svc.listTaskBoard(pool, req.query, req.authStaff) }); }
  catch (err) { return handleError(res, err, 'Could not load task board'); }
}

export async function updateTask(req, res) {
  try { return res.json(await svc.updateTask(pool, req.params.id, req.params.taskId, req.body, req.authStaff)); }
  catch (err) { return handleError(res, err, 'Could not update task'); }
}

export async function listAllDocuments(req, res) {
  try { return res.json({ items: await svc.listAllDocuments(pool, req.authStaff) }); }
  catch (err) { return handleError(res, err, 'Could not load documents'); }
}

export async function addDocument(req, res) {
  try { return res.status(201).json(await svc.addDocument(pool, req.params.id, req.body, req.authStaff)); }
  catch (err) { return handleError(res, err, 'Could not add document'); }
}

export async function updateDocument(req, res) {
  try { return res.json(await svc.updateDocument(pool, req.params.id, req.params.documentId, req.body, req.authStaff)); }
  catch (err) { return handleError(res, err, 'Could not update document'); }
}

export async function listAllPayments(req, res) {
  try { return res.json({ items: await svc.listAllPayments(pool, req.authStaff) }); }
  catch (err) { return handleError(res, err, 'Could not load payments'); }
}

export async function addPayment(req, res) {
  try { return res.status(201).json(await svc.addPayment(pool, req.params.id, req.body, req.authStaff)); }
  catch (err) { return handleError(res, err, 'Could not record payment'); }
}
