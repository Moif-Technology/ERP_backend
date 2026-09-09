/**
 * Dashboard Auth Repository
 * Staff lookup used only by the salon dashboard admin login.
 */

export async function findLoginCandidates(db, username) {
  const query = `
    SELECT
      s.id,
      s.staff_id,
      s.staff_name,
      s.role_id,
      s.branch_id,
      s.company_id,
      s.login_name,
      s.email,
      s.designation,
      s.password_hash,
      s.record_status,
      s.email_verified,
      c.company_name,
      c.company_address,
      c.business_variant,
      c.currency,
      b.branch_name,
      r.role_name,
      r.software_type AS role_software_type,
      st.software_code AS software_type_code,
      stn.station_id,
      stn.branch_id AS physical_branch_id,
      stn.station_type,
      stn.station_name AS station_name_sm
    FROM core.staff_master s
      JOIN core.company_master c ON c.company_id = s.company_id
      LEFT JOIN core.role_master r ON r.company_id = s.company_id AND r.role_id = s.role_id
      LEFT JOIN core.branch_master b ON b.company_id = s.company_id AND b.branch_id = s.branch_id
      LEFT JOIN core.software_type_master st ON st.software_type_id = c.software_type_id
      LEFT JOIN core.station_master stn
        ON stn.company_id = s.company_id
       AND stn.station_id = s.branch_id
       AND stn.is_deleted = FALSE
    WHERE LOWER(s.login_name) = LOWER($1)
       OR (s.email IS NOT NULL AND LOWER(TRIM(s.email)) = LOWER($1));
  `;

  return db.query(query, [username]);
}
