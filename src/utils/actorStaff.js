/**
 * core.staff_master primary key for the logged-in row (JWT access token `sub`).
 */
export function actorStaffPk(authStaff) {
  const n = Number(authStaff?.id);
  return Number.isFinite(n) && n >= 1 ? n : null;
}
