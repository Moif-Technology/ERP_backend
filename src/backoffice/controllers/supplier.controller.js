import { pool } from '../../config/db.js';
import * as supplierService from '../services/supplier.service.js';

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
    console.error(err);
    return res.status(500).json({ message: 'Could not create supplier' });
  }
}
