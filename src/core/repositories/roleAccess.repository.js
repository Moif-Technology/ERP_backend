import { pool } from '../../config/db.js';

export async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS core.role_page_access (
      company_id  INTEGER     NOT NULL,
      role_id     INTEGER     NOT NULL,
      page_path   VARCHAR(200) NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (company_id, role_id, page_path)
    )
  `);
}

export async function getPageAccess(companyId, roleId) {
  const { rows } = await pool.query(
    `SELECT page_path FROM core.role_page_access WHERE company_id = $1 AND role_id = $2 ORDER BY page_path`,
    [companyId, roleId]
  );
  return rows.map((r) => r.page_path);
}

export async function setPageAccess(companyId, roleId, pagePaths) {
  await pool.query(
    `DELETE FROM core.role_page_access WHERE company_id = $1 AND role_id = $2`,
    [companyId, roleId]
  );
  if (pagePaths.length > 0) {
    await pool.query(
      `INSERT INTO core.role_page_access (company_id, role_id, page_path)
       SELECT $1, $2, unnest($3::varchar[])
       ON CONFLICT DO NOTHING`,
      [companyId, roleId, pagePaths]
    );
  }
}

export async function getAllPageAccess(companyId) {
  const { rows } = await pool.query(
    `SELECT role_id, page_path FROM core.role_page_access WHERE company_id = $1`,
    [companyId]
  );
  const map = {};
  for (const row of rows) {
    if (!map[row.role_id]) map[row.role_id] = [];
    map[row.role_id].push(row.page_path);
  }
  return map;
}
