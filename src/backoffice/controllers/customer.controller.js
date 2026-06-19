import { pool } from '../../config/db.js';
import * as customerService from '../services/customer.service.js';

export async function listCustomers(req, res) {
  try {
    const customers = await customerService.listCustomers(
      pool,
      req.authStaff,
      req.query.limit,
      req.query.search ?? req.query.q
    );
    return res.json({ customers });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load customers' });
  }
}

export async function updateCustomer(req, res) {
  try {
    const updated = await customerService.updateCustomer(pool, req.params.customerId, req.body, req.authStaff);
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Customer code already exists for this company.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not update customer' });
  }
}

export async function createCustomer(req, res) {
  try {
    const created = await customerService.createCustomer(pool, req.body, req.authStaff);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    if (err.code === '23505') {
      const c = String(err.constraint || '');
      const dupCode = c.includes('customer_code') || c.includes('customercode');
      return res.status(409).json({
        message: dupCode
          ? 'Customer code already exists for this company'
          : 'Duplicate customer row.',
        constraint: c || undefined,
      });
    }
    if (err.code === '42P01') {
      return res
        .status(503)
        .json({ message: 'Customer table not installed. Run database migrations.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not create customer' });
  }
}

export async function postCustomerLedger(req, res) {
  try {
    const result = await customerService.postCustomerLedger(
      pool,
      req.params.customerId,
      req.authStaff,
      req.body || {},
    );
    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not post customer to accounts' });
  }
}
