/**
 * Session for ERP_frontend after login/register: staff user + company/branch context.
 * System parameters can be added later via a dedicated endpoint.
 */
export function buildSessionPayload(row, access = null) {
  const {
    staff_id: staffId,
    staff_name: staffName,
    role_id: roleId,
    role_name: roleName,
    login_name: loginName,
    email,
    designation,
    branch_id: rawBranchId,
    company_id: companyId,
    company_name: companyName,
    company_address: companyAddress,
    currency,
    branch_name: branchName,
    software_type_code: softwareTypeCode,
    station_id,
    physical_branch_id,
    station_type,
    station_name_sm,
  } = row;

  // stationId = software station (maps to station_master.station_id)
  // branchId  = physical location (maps to station_master.branch_id = branch_master.branch_id)
  // Falls back to rawBranchId for both when station JOIN returned nothing (edge case).
  const stationId = station_id ?? rawBranchId;
  const branchId  = physical_branch_id ?? rawBranchId;

  const payload = {
    user: {
      staffId,
      staffName,
      role: roleId != null ? String(roleId) : null,
      roleName: roleName || null,
      loginName: loginName || null,
      email: email || null,
      designation: designation || null,
      stationId,
      branchId,
      stationType: station_type || null,
    },
    company: {
      companyId,
      companyName,
      stationName: station_name_sm || branchName || 'Head Office',
      branchName: branchName || 'Head Office',
      address: companyAddress || '',
      softwareType: softwareTypeCode || 'ERP',
      currency: currency || 'AED',
    },
  };

  if (access) {
    payload.subscription = access.subscription;
    payload.features = access.features;
    payload.limits = access.limits;
    payload.permissions = access.permissions;
  }

  return payload;
}
