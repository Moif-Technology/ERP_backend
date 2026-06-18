import * as repo from '../repositories/crmDashboard.repository.js';
import { requireCompanyId } from '../../utils/crmHelpers.js';

export async function getDashboard(pool, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const [
    kpis,
    recentLeads,
    recentOpportunities,
    todayFollowups,
    pipelineByStage,
    leadSourceBreakdown,
    upcomingFollowups,
  ] = await Promise.all([
    repo.getKpis(pool, companyId),
    repo.getRecentLeads(pool, companyId),
    repo.getRecentOpportunities(pool, companyId),
    repo.getTodayFollowups(pool, companyId),
    repo.getPipelineByStage(pool, companyId),
    repo.getLeadSourceBreakdown(pool, companyId),
    repo.getUpcomingFollowups(pool, companyId),
  ]);

  return {
    kpis,
    recentLeads,
    recentOpportunities,
    todayFollowups,
    pipelineByStage,
    leadSourceBreakdown,
    upcomingFollowups,
  };
}
