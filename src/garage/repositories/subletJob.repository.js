function mapJob(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    branchId: Number(row.branch_id),
    subletNo: row.sublet_no,
    jobCardId: row.job_card_id == null ? null : Number(row.job_card_id),
    jcNo: row.jc_no,
    vendorId: row.vendor_id == null ? null : Number(row.vendor_id),
    vendorName: row.vendor_name,
    description: row.description,
    amount: row.amount == null ? null : Number(row.amount),
    status: row.status,
    createdAt: row.created_at,
    createdBy: row.created_by,
    modifiedAt: row.modified_at,
    modifiedBy: row.modified_by,
  };
}

export async function nextSubletNo(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(sublet_no,'[^0-9]','','g'),'') AS BIGINT)),0)+1 AS next_seq
     FROM garage.sublet_job WHERE company_id=$1 AND branch_id=$2`,
    [companyId, branchId]
  );
  return `SJ-${String(rows[0].next_seq).padStart(5, '0')}`;
}

export async function listSubletJobs(pool, companyId, branchId, filters) {
  const params = [companyId, branchId];
  let where = `WHERE company_id=$1 AND branch_id=$2`;
  if (filters.jobCardId) { params.push(filters.jobCardId); where += ` AND job_card_id=$${params.length}`; }
  if (filters.status) { params.push(filters.status); where += ` AND status=$${params.length}`; }
  const { rows } = await pool.query(
    `SELECT * FROM garage.sublet_job ${where} ORDER BY created_at DESC`,
    params
  );
  return rows.map(mapJob);
}

export async function findSubletJobById(pool, companyId, branchId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM garage.sublet_job WHERE company_id=$1 AND branch_id=$2 AND id=$3 LIMIT 1`,
    [companyId, branchId, id]
  );
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function insertSubletJob(pool, p) {
  const { rows } = await pool.query(
    `INSERT INTO garage.sublet_job (company_id,branch_id,sublet_no,job_card_id,jc_no,vendor_id,vendor_name,description,amount,status,created_by,modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'OPEN',$10,$10) RETURNING *`,
    [p.companyId, p.branchId, p.subletNo, p.jobCardId, p.jcNo, p.vendorId, p.vendorName, p.description, p.amount, p.createdBy]
  );
  return mapJob(rows[0]);
}

export async function updateSubletJob(pool, companyId, branchId, id, p) {
  const { rows } = await pool.query(
    `UPDATE garage.sublet_job SET vendor_id=$4,vendor_name=$5,description=$6,amount=$7,modified_at=NOW(),modified_by=$8
     WHERE company_id=$1 AND branch_id=$2 AND id=$3 AND status='OPEN' RETURNING *`,
    [companyId, branchId, id, p.vendorId, p.vendorName, p.description, p.amount, p.modifiedBy]
  );
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function setSubletJobStatus(pool, companyId, branchId, id, status, modifiedBy) {
  const { rows } = await pool.query(
    `UPDATE garage.sublet_job SET status=$4,modified_at=NOW(),modified_by=$5
     WHERE company_id=$1 AND branch_id=$2 AND id=$3 RETURNING *`,
    [companyId, branchId, id, status, modifiedBy]
  );
  return rows[0] ? mapJob(rows[0]) : null;
}
