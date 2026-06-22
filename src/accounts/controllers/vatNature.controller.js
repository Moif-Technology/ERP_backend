import { pool } from '../../config/db.js';
import * as vatNatureService from '../services/vatNature.service.js';

export async function listVatNatures(req, res, next) {
  try {
    const data = await vatNatureService.listVatNatures(pool, req.authStaff, req.query);
    res.json(data);
  } catch (e) {
    next(e);
  }
}
