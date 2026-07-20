import * as caseRepo from '../repositories/case.repository.js';
import { requireCompanyId } from '../../utils/crmHelpers.js';

export async function getDashboard(pool, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const [counts, pendingTasks, revenue, workload, pendingPayments, expiring] = await Promise.all([
    caseRepo.dashboardCounts(pool, companyId),
    caseRepo.pendingTaskCount(pool, companyId),
    caseRepo.revenueTotal(pool, companyId),
    caseRepo.staffWorkload(pool, companyId),
    caseRepo.pendingPayments(pool, companyId),
    caseRepo.getExpiringDocuments(pool, companyId, { fromDays: 0, toDays: 7 }),
  ]);
  return {
    ...counts,
    pendingTasks,
    revenue,
    workload,
    pendingPayments,
    expiringSoon: expiring,
  };
}

export async function getExpiryBuckets(pool, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const [expired, today, next7, next30] = await Promise.all([
    caseRepo.getExpiringDocuments(pool, companyId, { fromDays: -3650, toDays: -1 }),
    caseRepo.getExpiringDocuments(pool, companyId, { fromDays: 0, toDays: 0 }),
    caseRepo.getExpiringDocuments(pool, companyId, { fromDays: 1, toDays: 7 }),
    caseRepo.getExpiringDocuments(pool, companyId, { fromDays: 8, toDays: 30 }),
  ]);
  return { expired, today, next7, next30 };
}
