import { pool } from '../../config/db.js';
import * as supplierService from '../services/supplier.service.js';

export async function getSupplierById(req, res) {
  try {
    const supplier = await supplierService.getSupplierById(pool, req.params.supplierId, req.authStaff);
    return res.json({ supplier });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load supplier' });
  }
}

export async function listSuppliers(req, res) {
  try {
    const suppliers = await supplierService.listSuppliers(pool, req.authStaff, req.query);
    return res.json({ suppliers });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'Supplier table not installed. Run database migrations.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load suppliers' });
  }
}

export async function updateSupplier(req, res) {
  try {
    const updated = await supplierService.updateSupplier(pool, req.params.supplierId, req.body, req.authStaff);
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Duplicate supplier code for this company.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not update supplier' });
  }
}

export async function createSupplier(req, res) {
  try {
    const created = await supplierService.createSupplier(pool, req.body, req.authStaff);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Duplicate supplier code for this company.' });
    }
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'Supplier table not installed. Run database migrations.' });
    }
    if (err.code === '22P02') {
      return res.status(400).json({ message: err.message || 'Invalid supplier data' });
    }
    console.error(err);
    const detail = err.message && !err.status ? err.message : null;
    return res.status(500).json({
      message: detail && detail.length < 200 ? detail : 'Could not create supplier',
    });
  }
}

export async function postSupplierLedger(req, res) {
  try {
    const result = await supplierService.postSupplierLedger(
      pool,
      req.params.supplierId,
      req.authStaff,
      req.body || {},
    );
    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not post supplier to accounts' });
  }
}
