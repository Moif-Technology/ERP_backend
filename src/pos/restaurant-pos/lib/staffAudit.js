/** Logged-in staff id for VARCHAR audit columns (staff_id, else row id). */
export function auditStaffId(staff) {
  if (staff.staff_id != null && String(staff.staff_id).trim() !== '') {
    return String(staff.staff_id).trim().slice(0, 50);
  }
  if (staff.id != null) {
    return String(staff.id).trim().slice(0, 50);
  }
  return '0';
}
