/**
 * Data access for core.branch_master.
 */

export async function insertHeadOfficeBranch(client, { companyId, branchId, now }) {
  await client.query(
    `INSERT INTO core.branch_master (
      company_id, branch_id, branch_code, branch_name, status, created_at, updated_at
    ) VALUES ($1, $2, 'HQ', 'Head Office', 'ACTIVE', $3, $3)`,
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

export async function listBranchesByCompany(pool, companyId) {
  return pool.query(
    `SELECT branch_id, branch_code, branch_name, status
     FROM core.branch_master
     WHERE company_id = $1 AND status = 'ACTIVE'
     ORDER BY branch_id ASC`,
    [companyId]
  );
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
