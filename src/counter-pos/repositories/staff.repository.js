/**
 * Counter-POS staff lookups — self-contained, no imports from shared repos.
 */

const STAFF_SESSION_COLS = `
  s.id, s.staff_id, s.staff_name, s.role_id, s.branch_id, s.company_id,
  s.login_name, s.email, s.designation, s.record_status,
  c.company_name, c.company_address, b.branch_name, r.role_name,
  st.software_code AS software_type_code
`;

const SESSION_JOINS = `
  FROM core.staff_master s
  JOIN core.company_master c  ON c.company_id = s.company_id
  LEFT JOIN core.role_master r ON r.company_id = s.company_id AND r.role_id = s.role_id
  LEFT JOIN core.branch_master b ON b.company_id = s.company_id AND b.branch_id = s.branch_id
  LEFT JOIN core.software_type_master st ON st.software_type_id = c.software_type_id
`;

/** Find staff rows matching login_name or email (for device enrolment admin auth). */
export async function findLoginCandidates(pool, username) {
  return pool.query(
    `SELECT ${STAFF_SESSION_COLS}, s.password_hash
     ${SESSION_JOINS}
     WHERE LOWER(s.login_name) = LOWER($1)
        OR (s.email IS NOT NULL AND LOWER(TRIM(s.email)) = LOWER($1))`,
    [username],
  );
}

/** Find a single staff by staff_code within a company (for PIN login). */
export async function findStaffByCodeForCompany(pool, companyId, staffCode) {
  const { rows } = await pool.query(
    `SELECT ${STAFF_SESSION_COLS}, s.staff_pin
     ${SESSION_JOINS}
     WHERE s.company_id = $1
       AND UPPER(s.staff_code) = UPPER($2)
       AND s.record_status = 'ACTIVE'
     LIMIT 1`,
    [companyId, staffCode],
  );
  return rows[0] ?? null;
}

/** Load all active staff with their PIN hashes for PIN-only login. */
export async function findAllActiveStaffForCompany(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT ${STAFF_SESSION_COLS}, s.staff_pin
     ${SESSION_JOINS}
     WHERE s.company_id = $1
       AND s.record_status = 'ACTIVE'
       AND s.staff_pin IS NOT NULL`,
    [companyId],
  );
  return rows;
}
