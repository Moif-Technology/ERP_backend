/**
 * Report design persistence.
 * Lookup: branch-specific row first, then company-level (branch_id IS NULL) as fallback.
 */

export async function getDesign(pool, { companyId, branchId, reportKey }) {
  const { rows } = await pool.query(
    `SELECT design_json
       FROM core.report_designs
      WHERE company_id = $1
        AND report_key = $2
        AND (branch_id = $3 OR branch_id IS NULL)
      ORDER BY branch_id NULLS LAST
      LIMIT 1`,
    [companyId, reportKey, branchId ?? null],
  );
  return rows[0] ?? null;
}

export async function upsertDesign(pool, { companyId, branchId, reportKey, designJson }) {
  const { rows } = await pool.query(
    `INSERT INTO core.report_designs (company_id, branch_id, report_key, design_json, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT ON CONSTRAINT uq_report_designs
     DO UPDATE SET design_json = EXCLUDED.design_json, updated_at = NOW()
     RETURNING id`,
    [companyId, branchId ?? null, reportKey, JSON.stringify(designJson)],
  );
  return rows[0];
}

export async function deleteDesign(pool, { companyId, branchId, reportKey }) {
  await pool.query(
    `DELETE FROM core.report_designs
      WHERE company_id = $1
        AND report_key = $2
        AND (branch_id = $3 OR (branch_id IS NULL AND $3 IS NULL))`,
    [companyId, reportKey, branchId ?? null],
  );
}
