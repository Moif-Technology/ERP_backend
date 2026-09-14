import { pool } from '../../config/db.js';
import * as modifierService from '../services/modifier.service.js';

export async function listModifiers(req, res) {
  try {
    const modifiers = await modifierService.listModifiers(pool, req.authStaff, req.query.branchId);
    return res.json({ modifiers });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'Modifier table not installed. Run database migrations.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load modifiers' });
  }
}
