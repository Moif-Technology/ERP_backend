import { auditUserName } from '../../../shared/lib/auditUser.js';

/** CrBy / ModBy — logged-in user display name. */
export function auditStaffId(staff) {
  return auditUserName(staff);
}

export { auditUserName };
