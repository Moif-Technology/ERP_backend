import { pool } from '../../config/db.js';
import * as companyService from '../services/company.service.js';

export async function getProfile(req, res) {
  try {
    const profile = await companyService.getCompanyProfile(pool, req.authStaff);
    return res.json({ profile });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load company profile' });
  }
}

export async function updateProfile(req, res) {
  try {
    const updated = await companyService.updateCompanyProfile(pool, req.authStaff, req.body);
    return res.json({ profile: updated });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not update company profile' });
  }
}
