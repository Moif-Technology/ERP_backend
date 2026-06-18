import { pool } from '../../../config/db.js';
import * as groupRepo from '../repositories/group.repository.js';

export async function listGroups(authStaff) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);
  return groupRepo.listGroups(pool, companyId, branchId);
}
