import * as unitRepo from '../repositories/unit.repository.js';

export async function listUnits(pool, authStaff) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid session company');
    err.status = 401;
    throw err;
  }

  const count = await unitRepo.countUnitsByCompany(pool, companyId);
  if (count === 0) {
    const actor = String(authStaff.staff_name || authStaff.login_name || 'system').slice(0, 50);
    await unitRepo.seedDefaultUnits(pool, companyId, actor);
  }

  return unitRepo.listUnitsByCompany(pool, companyId);
}
