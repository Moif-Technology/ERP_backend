function map(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    branchId: Number(row.branch_id),
    jobCode: row.job_code,
    description: row.description,
    stdTime: row.std_time == null ? null : Number(row.std_time),
    unitCost: row.unit_cost == null ? null : Number(row.unit_cost),
    sellingPrice: row.selling_price == null ? null : Number(row.selling_price),
    status: row.status,
    createdAt: row.created_at,
    createdBy: row.created_by,
    modifiedAt: row.modified_at,
    modifiedBy: row.modified_by,
  };
}

export async function listJobDescriptions(pool, companyId, branchId, search) {
  const params = [companyId, branchId];
  let where = `WHERE company_id=$1 AND branch_id=$2`;
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (job_code ILIKE $${params.length} OR description ILIKE $${params.length})`;
  }
  const { rows } = await pool.query(
    `SELECT * FROM garage.job_description ${where} ORDER BY job_code`,
    params
  );
  return rows.map(map);
}

export async function findJobDescriptionById(pool, companyId, branchId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM garage.job_description WHERE company_id=$1 AND branch_id=$2 AND id=$3 LIMIT 1`,
    [companyId, branchId, id]
  );
  return rows[0] ? map(rows[0]) : null;
}

export async function insertJobDescription(pool, p) {
  const { rows } = await pool.query(
    `INSERT INTO garage.job_description (company_id,branch_id,job_code,description,std_time,unit_cost,selling_price,status,created_by,modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',$8,$8) RETURNING *`,
    [p.companyId, p.branchId, p.jobCode, p.description, p.stdTime, p.unitCost, p.sellingPrice, p.createdBy]
  );
  return map(rows[0]);
}

export async function updateJobDescription(pool, companyId, branchId, id, p) {
  const { rows } = await pool.query(
    `UPDATE garage.job_description SET job_code=$4,description=$5,std_time=$6,unit_cost=$7,selling_price=$8,
       status=$9,modified_at=NOW(),modified_by=$10
     WHERE company_id=$1 AND branch_id=$2 AND id=$3 RETURNING *`,
    [companyId, branchId, id, p.jobCode, p.description, p.stdTime, p.unitCost, p.sellingPrice, p.status, p.modifiedBy]
  );
  return rows[0] ? map(rows[0]) : null;
}

export async function deleteJobDescription(pool, companyId, branchId, id, modifiedBy) {
  const { rows } = await pool.query(
    `UPDATE garage.job_description SET status='INACTIVE',modified_at=NOW(),modified_by=$4
     WHERE company_id=$1 AND branch_id=$2 AND id=$3 RETURNING id`,
    [companyId, branchId, id, modifiedBy]
  );
  return rows[0] ? true : false;
}
