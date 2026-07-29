import { pool } from '../../config/db.js';
import * as planService from '../services/plan.service.js';

export async function getRegistrationOptions(_req, res) {
  try {
    return res.json(await planService.listRegistrationOptions());
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not load registration options' });
  }
}

const DB_NOT_READY =
  'Database is not ready. Run database/migrations/002_plan_master.sql (after 001).';

export async function listPlans(_req, res) {
  try {
    const payload = await planService.listPublicPlans(pool);
    return res.json(payload);
  } catch (err) {
    if (err.code === '42P01' || err.message?.includes('does not exist')) {
      return res.status(503).json({ message: DB_NOT_READY });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load plans' });
  }
}
