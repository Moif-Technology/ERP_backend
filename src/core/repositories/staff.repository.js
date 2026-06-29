/**
 * Data access for core.staff_master (+ session joins).
 */

/** New rows from Moifone self-registration until sync/server workflows apply. */
export const REGISTRATION_SYNC_STATUS = 'PENDING';
export const REGISTRATION_SERVER_STATUS = 'PENDING';

export function loginCandidatesSql(includeEmail) {
  return `SELECT s.id, s.staff_id, s.staff_name, s.role_id, s.branch_id, s.company_id,
              s.login_name, s.email, s.designation, s.password_hash, s.record_status,
              c.company_name, c.company_address, b.branch_name, r.role_name,
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
       LEFT JOIN core.station_master stn ON stn.company_id = s.company_id AND stn.station_id = s.branch_id AND stn.is_deleted = FALSE
       WHERE LOWER(s.login_name) = LOWER($1)
          ${includeEmail ? 'OR (s.email IS NOT NULL AND LOWER(TRIM(s.email)) = LOWER($1))' : ''}`;
}

export async function findLoginCandidates(pool, username) {
  try {
    return await pool.query(loginCandidatesSql(true), [username]);
  } catch (e) {
    if (e.code === '42703') {
      return pool.query(loginCandidatesSql(false), [username]);
    }
    throw e;
  }
}

/** Resolve the internal PK (core.staff_master.id) from company + business staff_id. */
export async function findStaffPk(db, companyId, staffId) {
  const { rows } = await db.query(
    `SELECT id FROM core.staff_master WHERE company_id = $1 AND staff_id = $2 LIMIT 1`,
    [companyId, staffId]
  );
  return rows.length ? Number(rows[0].id) : null;
}

export async function findStaffSessionByPk(pool, staffPk) {
  return pool.query(
    `SELECT s.id, s.staff_id, s.staff_name, s.role_id, s.branch_id, s.company_id,
            s.login_name, s.email, s.designation, r.role_name,
            r.software_type AS role_software_type,
            c.company_name, c.company_address, c.currency, b.branch_name,
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
     LEFT JOIN core.station_master stn ON stn.company_id = s.company_id AND stn.station_id = s.branch_id AND stn.is_deleted = FALSE
     WHERE s.id = $1 AND s.record_status = 'ACTIVE'`,
    [staffPk]
  );
}

export async function existsStaffWithEmail(client, email) {
  const { rows } = await client.query(
    `SELECT 1 FROM core.staff_master
     WHERE LOWER(login_name) = LOWER($1)
        OR (email IS NOT NULL AND LOWER(TRIM(email)) = LOWER($2))
     LIMIT 1`,
    [email, email]
  );
  return rows.length > 0;
}

export async function countActiveStaff(db, companyId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM core.staff_master
     WHERE company_id = $1
       AND record_status = 'ACTIVE'`,
    [companyId]
  );
  return Number(rows[0]?.n || 0);
}

export async function findStaffPksByRole(db, companyId, roleId) {
  const { rows } = await db.query(
    `SELECT id FROM core.staff_master
     WHERE company_id = $1 AND role_id = $2 AND record_status = 'ACTIVE'`,
    [companyId, roleId]
  );
  return rows.map((r) => Number(r.id));
}

export async function nextStaffId(client, companyId) {
  const { rows } = await client.query(
    'SELECT COALESCE(MAX(staff_id), 0) + 1 AS staff_id FROM core.staff_master WHERE company_id = $1',
    [companyId]
  );
  return Number(rows[0].staff_id);
}

export async function insertStaff(client, params) {
  const {
    companyId,
    staffId,
    branchId,
    staffCode,
    staffName,
    designation,
    email,
    passwordHash,
    pinHash = null,
    phone,
    roleId = null,
    now,
    createdBy = 'registration',
    modifiedBy = 'registration',
    createdByStaffId = null,
  } = params;
  await client.query(
    `INSERT INTO core.staff_master (
      company_id, staff_id, branch_id, staff_code, staff_name, designation,
      login_name, password_hash, staff_pin, role_id, duty_status, mobile_no, email,
      sync_status, server_status, record_status, created_at, created_by, modified_at, modified_by,
      created_by_staff_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, $11, $12,
      $13, $14, 'ACTIVE', $15, $16, $15, $17, $18
    )`,
    [
      companyId,
      staffId,
      branchId,
      staffCode,
      staffName,
      designation,
      email,
      passwordHash,
      pinHash,
      roleId,
      phone || null,
      email,
      REGISTRATION_SYNC_STATUS,
      REGISTRATION_SERVER_STATUS,
      now,
      createdBy,
      modifiedBy,
      createdByStaffId,
    ]
  );
}

/** True if another row (any company) already uses this login/email — same rule as self-registration. */
export async function existsStaffWithEmailGlobal(pool, email) {
  const { rows } = await pool.query(
    `SELECT 1 FROM core.staff_master
     WHERE LOWER(login_name) = LOWER($1)
        OR (email IS NOT NULL AND LOWER(TRIM(email)) = LOWER($2))
     LIMIT 1`,
    [email, email]
  );
  return rows.length > 0;
}

export async function findStaffForCompanyByStaffId(db, companyId, staffId) {
  const { rows } = await db.query(
    `SELECT staff_id, staff_code, staff_name, branch_id, designation, mobile_no, email, role_id
     FROM core.staff_master
     WHERE company_id = $1
       AND staff_id = $2
       AND record_status = 'ACTIVE'
     LIMIT 1`,
    [companyId, staffId]
  );
  return rows[0] ?? null;
}

/** Staff for company (business staff_id + display). Avoids optional columns some DBs lack. */
export async function listStaffForCompany(pool, companyId, { limit = 300 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 300, 1), 500);
  const { rows } = await pool.query(
    `SELECT
        s.staff_id,
        s.staff_code,
        s.staff_name,
        s.branch_id,
        s.designation,
        s.mobile_no,
        s.email,
        s.role_id,
        r.role_name,
        r.software_type,
        b.branch_name,
        (s.staff_pin IS NOT NULL) AS has_pin
     FROM core.staff_master s
     LEFT JOIN core.role_master r ON r.company_id = s.company_id AND r.role_id = s.role_id
     LEFT JOIN core.branch_master b ON b.company_id = s.company_id AND b.branch_id = s.branch_id
     WHERE s.company_id = $1
       AND s.record_status = 'ACTIVE'
     ORDER BY s.staff_name ASC NULLS LAST
     LIMIT $2`,
    [companyId, lim],
  );
  return rows;
}

export async function updateStaffDetails(db, params) {
  const { companyId, staffId, staffName, designation, branchId, mobileNo, email, actor } = params;
  const { rows } = await db.query(
    `UPDATE core.staff_master
     SET staff_name    = $3,
         designation   = $4,
         branch_id     = $5,
         mobile_no     = $6,
         email         = $7,
         login_name    = $7,
         modified_at   = CURRENT_TIMESTAMP,
         modified_by   = $8
     WHERE company_id = $1
       AND staff_id   = $2
       AND record_status = 'ACTIVE'
     RETURNING staff_id, staff_code, staff_name, branch_id, designation, mobile_no, email, role_id`,
    [companyId, staffId, staffName, designation, branchId, mobileNo || null, email, actor]
  );
  return rows[0] ?? null;
}

export async function updateStaffRole(db, params) {
  const { companyId, staffId, roleId, actor = 'staff-role' } = params;
  const { rows } = await db.query(
    `UPDATE core.staff_master
     SET role_id = $3,
         modified_at = CURRENT_TIMESTAMP,
         modified_by = $4
     WHERE company_id = $1
       AND staff_id = $2
       AND record_status = 'ACTIVE'
     RETURNING staff_id, staff_code, staff_name, branch_id, designation, mobile_no, email, role_id`,
    [companyId, staffId, roleId, actor]
  );
  return rows[0] ?? null;
}

export async function selectStaffSessionRow(client, companyId, staffId) {
  const { rows } = await client.query(
    `SELECT s.id, s.staff_id, s.staff_name, s.role_id, s.branch_id, s.company_id,
            s.login_name, s.email, s.designation, r.role_name,
            r.software_type AS role_software_type,
            c.company_name, c.company_address, b.branch_name,
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
     LEFT JOIN core.station_master stn ON stn.company_id = s.company_id AND stn.station_id = s.branch_id AND stn.is_deleted = FALSE
     WHERE s.company_id = $1 AND s.staff_id = $2`,
    [companyId, staffId]
  );
  return rows[0] ?? null;
}

export async function findAllActiveStaffWithPinForCompany(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT s.id, s.staff_id, s.staff_name, s.role_id, s.branch_id, s.company_id,
            s.login_name, s.email, s.designation, s.staff_pin, s.record_status,
            c.company_name, c.company_address, b.branch_name, r.role_name,
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
     LEFT JOIN core.station_master stn ON stn.company_id = s.company_id AND stn.station_id = s.branch_id AND stn.is_deleted = FALSE
     WHERE s.company_id = $1
       AND s.record_status = 'ACTIVE'
       AND s.staff_pin IS NOT NULL`,
    [companyId]
  );
  return rows;
}

// ── PIN login ─────────────────────────────────────────────────────────────────

export async function findStaffByCodeForCompany(pool, companyId, staffCode) {
  const { rows } = await pool.query(
    `SELECT s.id, s.staff_id, s.staff_name, s.role_id, s.branch_id, s.company_id,
            s.login_name, s.email, s.designation, s.staff_pin, s.record_status,
            c.company_name, c.company_address, b.branch_name, r.role_name,
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
     LEFT JOIN core.station_master stn ON stn.company_id = s.company_id AND stn.station_id = s.branch_id AND stn.is_deleted = FALSE
     WHERE s.company_id = $1
       AND UPPER(s.staff_code) = UPPER($2)
       AND s.record_status = 'ACTIVE'
     LIMIT 1`,
    [companyId, staffCode]
  );
  return rows[0] ?? null;
}

export async function updateStaffPin(pool, companyId, staffId, pinHash) {
  const { rowCount } = await pool.query(
    `UPDATE core.staff_master
     SET staff_pin = $3, modified_at = NOW(), modified_by = 'pin_update'
     WHERE company_id = $1 AND staff_id = $2 AND record_status = 'ACTIVE'`,
    [companyId, staffId, pinHash]
  );
  return rowCount === 1;
}

// ── Password hash ─────────────────────────────────────────────────────────────

export async function updatePasswordHashByStaffPk(client, staffPk, passwordHash) {
  const { rowCount } = await client.query(
    `UPDATE core.staff_master
     SET password_hash = $2, modified_at = NOW(), modified_by = 'password_reset'
     WHERE id = $1 AND record_status = 'ACTIVE'`,
    [staffPk, passwordHash]
  );
  return rowCount === 1;
}
