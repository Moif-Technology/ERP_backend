async function nextId(client, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(designation_id), 0) + 1 AS next_id FROM core.designation_master WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId],
  );
  return Number(rows[0].next_id);
}
export const nextDesignationId = (c, co, br) => nextId(c, co, br);

export async function listDesignations(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT designation_id, designation_name FROM core.designation_master WHERE company_id=$1 AND branch_id=$2 ORDER BY designation_name ASC`,
    [companyId, branchId],
  );
  return rows.map((r) => ({ designationId: Number(r.designation_id), designationName: r.designation_name }));
}

export async function insertDesignation(client, d) {
  const { rows } = await client.query(
    `INSERT INTO core.designation_master (company_id, branch_id, designation_id, designation_name)
     VALUES ($1, $2, $3, $4) RETURNING designation_id, designation_name`,
    [d.companyId, d.branchId, d.designationId, d.designationName],
  );
  return { designationId: Number(rows[0].designation_id), designationName: rows[0].designation_name };
}

export async function deleteDesignation(pool, companyId, branchId, designationId) {
  await pool.query(
    `DELETE FROM core.designation_master WHERE company_id=$1 AND branch_id=$2 AND designation_id=$3`,
    [companyId, branchId, designationId],
  );
}

const DEFAULT_DESIGNATIONS = [
  'Chief Executive Officer / Owner',
  'General Manager',
  'Operations Manager',
  'Sales Manager',
  'Purchase Manager',
  'Finance Manager',
  'IT Manager',
  'HR Manager',
  'Sales Team Lead',
  'Manager',
  'Accountant',
  'Cashier',
  'Sales Executive',
  'Warehouse',
  'Other',
];

// Seeds the default designation list for a branch (new company signup, or a new
// branch added to an existing company). Safe to call repeatedly — ON CONFLICT DO NOTHING.
export async function seedDefaultDesignations(db, companyId, branchId) {
  await db.query(
    `INSERT INTO core.designation_master (company_id, branch_id, designation_id, designation_name)
     SELECT $1, $2, gs.ord, gs.name
     FROM UNNEST($3::text[]) WITH ORDINALITY AS gs(name, ord)
     ON CONFLICT (company_id, branch_id, designation_id) DO NOTHING`,
    [companyId, branchId, DEFAULT_DESIGNATIONS],
  );
}
