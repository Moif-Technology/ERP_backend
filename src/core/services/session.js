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
    branch_id: stationId,
    company_id: companyId,
    company_name: companyName,
    company_address: companyAddress,
    currency,
    branch_name: branchName,
    software_type_code: softwareTypeCode,
  } = row;

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
    },
    company: {
      companyId,
      companyName,
      stationName: branchName || 'Head Office',
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
