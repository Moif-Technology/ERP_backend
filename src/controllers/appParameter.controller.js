import * as appParameterService from '../services/appParameter.service.js';

export async function getGvTax(req, res) {
  try {
    const data = await appParameterService.getGvTax(req.authStaff, req.query);
    return res.json(data);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ message: err.message || 'Failed to load gvtax' });
  }
}
