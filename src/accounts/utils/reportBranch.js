export function parseOptionalBranchId(raw) {
  if (raw == null || String(raw).trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : undefined;
}

/**
 * Report branch resolution:
 * - branchId in query → that branch
 * - allBranches=1 / branchId='' → company-wide (all branches)
 * - omitted → logged-in staff branch (legacy station default)
 */
export function resolveReportBranchId(query = {}, authStaff = {}) {
  if (query.allBranches === '1' || query.allBranches === 'true') return undefined;
  if (query.branchId != null && String(query.branchId).trim() === '') return undefined;
  const fromQuery = parseOptionalBranchId(query.branchId);
  if (fromQuery != null) return fromQuery;
  if (query.branchId != null) return undefined;
  return parseOptionalBranchId(authStaff.branch_id ?? authStaff.station_id);
}
