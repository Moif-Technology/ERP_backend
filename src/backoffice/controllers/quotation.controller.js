import { pool } from '../../config/db.js';
import * as quotationService from '../services/quotation.service.js';

export async function createQuotation(req, res) {
  try {
    const result = await quotationService.createQuotation(pool, req.body, req.authStaff);
    return res.status(201).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    if (err.code === '42P01' || err.code === '23503') {
      return res.status(503).json({
        message:
          err.code === '42P01'
            ? 'Quotation tables not installed. Run database/migrations/022_ops_quotation_and_document_sequence.sql (core.document_sequence + ops.quotation_*)'
            : 'Invalid reference (customer, product, or branch).',
      });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not create quotation' });
  }
}

export async function getQuotation(req, res) {
  try {
    const result = await quotationService.getQuotation(pool, req.authStaff, req.params.quotationId);
    return res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'Quotation tables not installed.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load quotation' });
  }
}

export async function listQuotations(req, res) {
  try {
    const rows = await quotationService.listQuotations(pool, req.authStaff, req.query);
    return res.json({ quotations: rows });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'Quotation tables not installed.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not list quotations' });
  }
}
