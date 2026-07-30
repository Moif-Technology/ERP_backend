import { pool } from '../../../config/db.js';
import * as kotService from '../services/kot.service.js';

export async function saveKot(req, res) {
  try {
    const out = await kotService.saveKot(pool, req.body, req.authStaff, req.access);
    return res.status(200).json(out);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, message: err.message });
    if (err.code === '42P01') {
      return res.status(503).json({
        ok: false,
        message: 'KOT tables not installed. Run migration 016_ops_kot_master_child.sql.',
      });
    }
    if (err.code === '42703') {
      return res.status(503).json({
        ok: false,
        message:
          'KOT table is missing columns (e.g. created_by). Run database/migrations/017_ops_kot_audit_columns.sql on your database.',
      });
    }
    if (err.code === '23502') {
      console.error('[kot save] NOT NULL', err.message, err.column);
      return res.status(503).json({ ok: false, message: err.message });
    }
    console.error('[saveKot] Error:', err.message, 'Code:', err.code, 'Detail:', err.detail);
    return res.status(500).json({ ok: false, message: `Could not save KOT: ${err.message}` });
  }
}

export async function listKots(req, res) {
  try {
    const out = await kotService.listKots(pool, req.authStaff, req.query);
    return res.json(out);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, message: err.message });
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Could not list KOTs' });
  }
}

export async function getKot(req, res) {
  try {
    const kotDetails = await kotService.getKot(pool, req.authStaff, req.params.kotMasterId);
    return res.json(kotDetails);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '42703') {
      return res.status(503).json({
        message:
          'KOT table is missing columns. Run database/migrations/017_ops_kot_audit_columns.sql.',
      });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load KOT' });
  }
}
