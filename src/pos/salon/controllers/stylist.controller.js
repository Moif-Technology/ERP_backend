import { pool } from '../../../config/db.js';
import * as stylistService from '../services/stylist.service.js';

export async function listStylists(req, res) {
  try {
    return res.json(await stylistService.listStylists(pool, req.authStaff, req.query));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ ok: false, code: err.code ?? null, message: err.message });
    }
    console.error('[salon stylists]', err);
    return res.status(500).json({ ok: false, code: 'INTERNAL', message: 'Could not load stylists' });
  }
}

export async function getStylistLoad(req, res) {
  try {
    return res.json(await stylistService.getStylistLoad(pool, req.authStaff, req.params.stylistId));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ ok: false, code: err.code ?? null, message: err.message });
    }
    console.error('[salon stylist load]', err);
    return res.status(500).json({ ok: false, code: 'INTERNAL', message: 'Could not load stylist' });
  }
}
