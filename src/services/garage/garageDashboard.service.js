import { requireBranchId, requireCompanyId } from '../../utils/crmHelpers.js';
import * as repo from '../../repositories/garage/garageDashboard.repository.js';

export async function getDashboardKpis(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, query);
  return repo.getDashboardKpis(pool, companyId, branchId);
}
