import { verifyAccessToken } from '../services/token.service.js';
import { pool } from '../config/db.js';
import * as staffRepo from '../repositories/staff.repository.js';

export async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    if (payload.typ !== 'access' || payload.sub == null) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const staffPk = Number(payload.sub);
    const { rows } = await staffRepo.findStaffSessionByPk(pool, staffPk);
    if (!rows.length) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.authStaff = rows[0];
    next();
  } catch {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}
