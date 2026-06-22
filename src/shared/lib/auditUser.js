/**
 * Legacy CrBy / ModBy — display name of the logged-in user (not staff id).
 */
export function auditUserName(authStaff, maxLen = 50) {
  const name = String(authStaff?.staff_name || authStaff?.login_name || '').trim();
  if (!name) return 'system';
  return name.slice(0, maxLen);
}
