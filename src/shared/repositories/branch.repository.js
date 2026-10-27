/**
 * Data access for core.branch_master.
 */

export async function insertHeadOfficeBranch(client, { companyId, branchId, now }) {
  await client.query(
    `INSERT INTO core.branch_master (
      company_id, branch_id, branch_code, branch_name, branch_type, status, created_at, updated_at
    ) VALUES ($1, $2, 'HQ', 'Head Office', 'HEAD_OFFICE', 'ACTIVE', $3, $3)`,
    [companyId, branchId, now]
  );
}

export async function countActiveBranches(db, companyId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM core.branch_master
     WHERE company_id = $1 AND status = 'ACTIVE'`,
    [companyId]
  );
  return Number(rows[0]?.n || 0);
}

// location_type comes from migration 134; until it runs, fall back to the old
// column list so the branch list (used everywhere) keeps working.
function isMissingLocationType(err) {
  return err?.code === '42703' && /location_type/.test(String(err.message));
}

export async function listBranchesByCompany(pool, companyId) {
  try {
    return await pool.query(
      `SELECT branch_id, branch_code, branch_name, branch_type, location_type, address, phone, status
       FROM core.branch_master
       WHERE company_id = $1 AND status = 'ACTIVE'
       ORDER BY branch_id ASC`,
      [companyId]
    );
  } catch (err) {
    if (!isMissingLocationType(err)) throw err;
    return pool.query(
      `SELECT branch_id, branch_code, branch_name, branch_type, 'SHOP' AS location_type, address, phone, status
       FROM core.branch_master
       WHERE company_id = $1 AND status = 'ACTIVE'
       ORDER BY branch_id ASC`,
      [companyId]
    );
  }
}

export async function branchBelongsToCompany(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM core.branch_master
     WHERE company_id = $1 AND branch_id = $2 AND status = 'ACTIVE'
     LIMIT 1`,
    [companyId, branchId]
  );
  return rows.length > 0;
}

export async function nextBranchId(db, companyId) {
  const { rows } = await db.query(
    `SELECT COALESCE(MAX(branch_id), 0) + 1 AS next_id
     FROM core.branch_master
     WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].next_id);
}

export async function insertBranch(db, { companyId, branchId, branchCode, branchName, branchType, locationType, address, phone, actor }) {
  const params = [companyId, branchId, branchCode, branchName, branchType || 'GENERAL', address || null, phone || null];
  try {
    const { rows } = await db.query(
      `INSERT INTO core.branch_master
         (company_id, branch_id, branch_code, branch_name, branch_type, address, phone, location_type, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING branch_id, branch_code, branch_name, branch_type, location_type, address, phone, status`,
      [...params, locationType || 'SHOP']
    );
    return rows[0];
  } catch (err) {
    if (!isMissingLocationType(err)) throw err;
  }
  const { rows } = await db.query(
    `INSERT INTO core.branch_master
       (company_id, branch_id, branch_code, branch_name, branch_type, address, phone, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING branch_id, branch_code, branch_name, branch_type, address, phone, status`,
    params
  );
  return rows[0];
}

export async function updateBranch(db, { companyId, branchId, branchCode, branchName, branchType, locationType, address, phone }) {
  const params = [companyId, branchId, branchCode, branchName, branchType || 'GENERAL', address || null, phone || null];
  try {
    const { rows } = await db.query(
      `UPDATE core.branch_master
       SET branch_code   = $3,
           branch_name   = $4,
           branch_type   = $5,
           address       = $6,
           phone         = $7,
           location_type = $8,
           updated_at    = CURRENT_TIMESTAMP
       WHERE company_id = $1 AND branch_id = $2 AND status = 'ACTIVE'
       RETURNING branch_id, branch_code, branch_name, branch_type, location_type, address, phone, status`,
      [...params, locationType || 'SHOP']
    );
    return rows[0] ?? null;
  } catch (err) {
    if (!isMissingLocationType(err)) throw err;
  }
  const { rows } = await db.query(
    `UPDATE core.branch_master
     SET branch_code  = $3,
         branch_name  = $4,
         branch_type  = $5,
         address      = $6,
         phone        = $7,
         updated_at   = CURRENT_TIMESTAMP
     WHERE company_id = $1 AND branch_id = $2 AND status = 'ACTIVE'
     RETURNING branch_id, branch_code, branch_name, branch_type, address, phone, status`,
    params
  );
  return rows[0] ?? null;
}

export async function softDeleteBranch(db, companyId, branchId) {
  const { rowCount } = await db.query(
    `UPDATE core.branch_master
     SET status = 'INACTIVE', updated_at = CURRENT_TIMESTAMP
     WHERE company_id = $1 AND branch_id = $2 AND status = 'ACTIVE'`,
    [companyId, branchId]
  );
  return rowCount === 1;
}
