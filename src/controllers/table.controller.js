import { pool } from '../config/db.js';
import * as tableService from '../services/table.service.js';

export async function listTables(req, res) {
  try {
    const tables = await tableService.listTables(
      pool,
      req.authStaff,
      req.query.branchId,
      req.query.areaId
    );
    return res.json({ tables });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load tables' });
  }
}

export async function createTable(req, res) {
  try {
    const created = await tableService.createTable(pool, req.body, req.authStaff);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') {
      const c = String(err.constraint || '');
      const msg = c.includes('table_no')
        ? 'A table with this number already exists in this area'
        : c.includes('table_name')
        ? 'A table with this name already exists in this area'
        : 'Duplicate table row.';
      return res.status(409).json({ message: msg, constraint: c || undefined });
    }
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'Table master table not installed. Run database migrations.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not create table' });
  }
}
