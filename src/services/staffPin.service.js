import bcrypt from 'bcryptjs';
import * as staffRepo from '../repositories/staff.repository.js';

export async function setStaffPin(pool, staffIdRaw, body, authStaff) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid session company');
    err.status = 401;
    throw err;
  }

  const staffId = Number(staffIdRaw);
  if (!Number.isFinite(staffId) || staffId < 1) {
    const err = new Error('Invalid staffId');
    err.status = 400;
    throw err;
  }

  const pin = String(body?.pin || '').trim();
  if (!/^\d{4,6}$/.test(pin)) {
    const err = new Error('PIN must be 4–6 digits');
    err.status = 400;
    throw err;
  }

  const pinHash = await bcrypt.hash(pin, 12);
  const updated = await staffRepo.updateStaffPin(pool, companyId, staffId, pinHash);
  if (!updated) {
    const err = new Error('Staff not found');
    err.status = 404;
    throw err;
  }

  return { ok: true, staffId };
}
