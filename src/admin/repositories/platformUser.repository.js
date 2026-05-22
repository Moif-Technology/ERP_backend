import { pool } from '../../config/db.js';

export async function findByEmail(email) {
  const { rows } = await pool.query(
    `SELECT platform_user_id, email, password_hash, full_name, is_active
       FROM core.platform_user
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

export async function findById(platformUserId) {
  const { rows } = await pool.query(
    `SELECT platform_user_id, email, full_name, is_active, last_login_at
       FROM core.platform_user
      WHERE platform_user_id = $1
      LIMIT 1`,
    [platformUserId]
  );
  return rows[0] || null;
}

export async function listCapabilities(platformUserId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT prc.capability_code
       FROM core.platform_user_role pur
       JOIN core.platform_role pr ON pr.platform_role_id = pur.platform_role_id
       JOIN core.platform_role_capability prc ON prc.platform_role_id = pr.platform_role_id
      WHERE pur.platform_user_id = $1
        AND pr.is_active = TRUE`,
    [platformUserId]
  );
  return rows.map((r) => r.capability_code);
}

export async function listRoles(platformUserId) {
  const { rows } = await pool.query(
    `SELECT pr.role_code, pr.role_name
       FROM core.platform_user_role pur
       JOIN core.platform_role pr ON pr.platform_role_id = pur.platform_role_id
      WHERE pur.platform_user_id = $1
        AND pr.is_active = TRUE`,
    [platformUserId]
  );
  return rows;
}

export async function touchLastLogin(platformUserId) {
  await pool.query(
    `UPDATE core.platform_user
        SET last_login_at = NOW(), updated_at = NOW()
      WHERE platform_user_id = $1`,
    [platformUserId]
  );
}
