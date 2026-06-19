import { pool } from '../../config/db.js';
import * as accountsParameterService from '../services/accountsParameter.service.js';

export async function getBranchDefaults(req, res) {
  try {
    const data = await accountsParameterService.getBranchDefaults(pool, req.authStaff, req.query);
    return res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '42P01') {
      return res.status(503).json({
        message: 'Accounts tables missing. Run database/migrations/030_accounts_chart_and_parameters.sql',
      });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load branch account defaults' });
  }
}

export async function patchBranchDefaults(req, res) {
  try {
    const data = await accountsParameterService.updateBranchDefaults(pool, req.authStaff, req.body);
    return res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '42P01') {
      return res.status(503).json({
        message: 'Accounts tables missing. Run database/migrations/030_accounts_chart_and_parameters.sql',
      });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not update branch defaults' });
  }
}

export async function getBranchIntegration(req, res) {
  try {
    const data = await accountsParameterService.getBranchIntegration(pool, req.authStaff, req.query);
    return res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load account integration' });
  }
}

export async function patchBranchIntegration(req, res) {
  try {
    const data = await accountsParameterService.updateBranchIntegration(pool, req.authStaff, req.body);
    return res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not save account integration' });
  }
}
