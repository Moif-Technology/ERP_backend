import * as companyRepo from '../repositories/company.repository.js';

export async function getCompanyProfile(pool, authStaff) {
  const profile = await companyRepo.getCompanyProfile(pool, authStaff.company_id);
  if (!profile) {
    const err = new Error('Company not found');
    err.status = 404;
    throw err;
  }
  const branches = await companyRepo.listBranchesForProfile(pool, authStaff.company_id);
  return { ...profile, branches };
}

export async function updateCompanyProfile(pool, authStaff, body) {
  if (!isOwnerOrAdmin(authStaff)) {
    const err = new Error('Only admin or owner can update company profile');
    err.status = 403;
    throw err;
  }
  const updated = await companyRepo.updateCompanyProfile(pool, authStaff.company_id, body);
  if (!updated) {
    const err = new Error('Company not found');
    err.status = 404;
    throw err;
  }
  return updated;
}

function isOwnerOrAdmin(authStaff) {
  const role = String(authStaff.role_name || authStaff.roleName || '').toLowerCase();
  return role === 'owner' || role === 'admin' || authStaff.is_owner === true;
}
