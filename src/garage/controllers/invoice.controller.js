import { pool } from '../../config/db.js';
import * as service from '../services/invoice.service.js';

export async function listInvoices(req, res) {
  try { return res.json({ invoices: await service.listInvoices(pool, req.query, req.authStaff) }); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not load invoices' }); }
}

export async function getInvoiceById(req, res) {
  try { return res.json(await service.getInvoiceById(pool, req.params.id, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not load invoice' }); }
}

export async function getInvoiceByJobCard(req, res) {
  try {
    const inv = await service.getInvoiceByJobCard(pool, req.params.jcNo, req.authStaff);
    if (!inv) return res.status(404).json({ message: 'No invoice found for this job card' });
    return res.json(inv);
  } catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not load invoice' }); }
}

export async function createInvoice(req, res) {
  try { return res.status(201).json(await service.createInvoice(pool, req.body, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); if (err.code === '23505') return res.status(409).json({ message: 'Duplicate invoice number' }); console.error(err); return res.status(500).json({ message: 'Could not create invoice' }); }
}

export async function updateInvoice(req, res) {
  try { return res.json(await service.updateInvoice(pool, req.params.id, req.body, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not update invoice' }); }
}

export async function postInvoice(req, res) {
  try { return res.json(await service.postInvoice(pool, req.params.id, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not post invoice' }); }
}

export async function cancelInvoice(req, res) {
  try { return res.json(await service.cancelInvoice(pool, req.params.id, req.authStaff)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error(err); return res.status(500).json({ message: 'Could not cancel invoice' }); }
}
