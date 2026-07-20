import { pool } from '../../config/db.js';
import * as userPreferenceService from '../services/userPreference.service.js';

export async function getPreference(req, res) {
  try {
    const result = await userPreferenceService.getPreference(pool, req.authStaff, req.query);
    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('[userPreference:get]', err);
    return res.status(500).json({ message: 'Could not load preference' });
  }
}

export async function savePreference(req, res) {
  try {
    const result = await userPreferenceService.savePreference(pool, req.authStaff, req.body);
    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('[userPreference:save]', err);
    return res.status(500).json({ message: 'Could not save preference' });
  }
}
