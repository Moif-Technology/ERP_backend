import { pool } from '../../config/db.js';
import * as svc from '../services/systemParameter.service.js';

export async function getAll(req, res) {
  try {
    const { values, definitions } = await svc.getAllParameters(pool, req.authStaff.company_id);
    return res.json({ parameters: values, definitions });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load parameters' });
  }
}

export async function getModule(req, res) {
  try {
    const params = await svc.getModuleParameters(pool, req.authStaff.company_id, req.params.module);
    return res.json({ module: req.params.module.toUpperCase(), parameters: params });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load module parameters' });
  }
}

export async function updateModule(req, res) {
  try {
    const updatedBy = String(req.authStaff.staff_id || 'api');
    const result = await svc.updateModuleParameters(
      pool, req.authStaff.company_id, req.params.module, req.body, updatedBy
    );
    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not update parameters' });
  }
}
