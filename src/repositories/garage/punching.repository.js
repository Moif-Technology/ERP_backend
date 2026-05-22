function map(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    branchId: Number(row.branch_id),
    jobCardId: row.job_card_id == null ? null : Number(row.job_card_id),
    jcNo: row.jc_no,
    technicianId: row.technician_id == null ? null : Number(row.technician_id),
    techName: row.tech_name ?? null,
    jobCode: row.job_code,
    startTime: row.start_time,
    endTime: row.end_time,
    actualHours: row.actual_hours == null ? null : Number(row.actual_hours),
    remarks: row.remarks,
    status: row.status,
    createdAt: row.created_at,
    createdBy: row.created_by,
    modifiedAt: row.modified_at,
    modifiedBy: row.modified_by,
  };
}

export async function listPunchings(pool, companyId, branchId, filters) {
  const params = [companyId, branchId];
  let where = `WHERE p.company_id=$1 AND p.branch_id=$2`;
  if (filters.jobCardId) { params.push(filters.jobCardId); where += ` AND p.job_card_id=$${params.length}`; }
  if (filters.technicianId) { params.push(filters.technicianId); where += ` AND p.technician_id=$${params.length}`; }
  if (filters.status) { params.push(filters.status); where += ` AND p.status=$${params.length}`; }
  const { rows } = await pool.query(
    `SELECT p.*, t.tech_name
     FROM garage.job_code_punching p
     LEFT JOIN garage.technician t ON t.id = p.technician_id
     ${where}
     ORDER BY p.created_at DESC`,
    params
  );
  return rows.map(map);
}

export async function findPunchingById(pool, companyId, branchId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM garage.job_code_punching WHERE company_id=$1 AND branch_id=$2 AND id=$3 LIMIT 1`,
    [companyId, branchId, id]
  );
  return rows[0] ? map(rows[0]) : null;
}

export async function listPunchingsByJobCard(pool, companyId, branchId, jcNo) {
  const { rows } = await pool.query(
    `SELECT p.*, t.tech_name
     FROM garage.job_code_punching p
     LEFT JOIN garage.technician t ON t.id = p.technician_id
     WHERE p.company_id=$1 AND p.branch_id=$2 AND p.jc_no=$3
     ORDER BY p.start_time`,
    [companyId, branchId, jcNo]
  );
  return rows.map(r => ({ ...map(r), techName: r.tech_name }));
}

export async function insertPunching(pool, p) {
  const { rows } = await pool.query(
    `INSERT INTO garage.job_code_punching
       (company_id,branch_id,job_card_id,jc_no,technician_id,job_code,start_time,end_time,actual_hours,remarks,status,created_by,modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'OPEN',$11,$11) RETURNING *`,
    [p.companyId, p.branchId, p.jobCardId, p.jcNo, p.technicianId, p.jobCode,
     p.startTime, p.endTime, p.actualHours, p.remarks, p.createdBy]
  );
  return map(rows[0]);
}

export async function updatePunching(pool, companyId, branchId, id, p) {
  const { rows } = await pool.query(
    `UPDATE garage.job_code_punching
     SET technician_id=$4,job_code=$5,start_time=$6,end_time=$7,actual_hours=$8,remarks=$9,status=$10,
         modified_at=NOW(),modified_by=$11
     WHERE company_id=$1 AND branch_id=$2 AND id=$3 RETURNING *`,
    [companyId, branchId, id, p.technicianId, p.jobCode, p.startTime, p.endTime,
     p.actualHours, p.remarks, p.status, p.modifiedBy]
  );
  return rows[0] ? map(rows[0]) : null;
}

export async function cancelPunching(pool, companyId, branchId, id, modifiedBy) {
  const { rows } = await pool.query(
    `UPDATE garage.job_code_punching SET status='CANCELLED',modified_at=NOW(),modified_by=$4
     WHERE company_id=$1 AND branch_id=$2 AND id=$3 RETURNING id`,
    [companyId, branchId, id, modifiedBy]
  );
  return rows[0] ? true : false;
}
