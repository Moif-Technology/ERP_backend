function mapRow(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    branchId: Number(row.branch_id),
    preJcId: Number(row.pre_jc_id),
    regNo: row.reg_no,
    chassisNo: row.chassis_no,
    customerName: row.customer_name,
    serviceAdvisor: row.service_advisor,
    bookingDate: row.booking_date,
    bookingTime: row.booking_time,
    kmReading: row.km_reading == null ? null : Number(row.km_reading),
    remarks: row.remarks,
    policeReport: row.police_report,
    warrantyRepair: row.warranty_repair,
    totalLoss: row.total_loss,
    status: row.status,
    jobCardId: row.job_card_id == null ? null : Number(row.job_card_id),
    createdAt: row.created_at,
    createdBy: row.created_by,
    modifiedAt: row.modified_at,
    modifiedBy: row.modified_by,
  };
}

export async function nextPreJcId(client, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(pre_jc_id), 0) + 1 AS next_id
     FROM garage.pre_job_card
     WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId]
  );
  return Number(rows[0].next_id);
}

export async function listPreJobCards(pool, companyId, branchId, search = null) {
  const params = [companyId, branchId];
  let where = `WHERE p.company_id = $1 AND p.branch_id = $2`;
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (p.reg_no ILIKE $3 OR COALESCE(p.customer_name,'') ILIKE $3 OR COALESCE(p.chassis_no,'') ILIKE $3)`;
  }
  const { rows } = await pool.query(
    `SELECT p.* FROM garage.pre_job_card p ${where} ORDER BY p.created_at DESC, p.pre_jc_id DESC`,
    params
  );
  return rows.map(mapRow);
}

export async function findPreJobCardById(pool, companyId, branchId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM garage.pre_job_card
     WHERE company_id = $1 AND branch_id = $2 AND id = $3 LIMIT 1`,
    [companyId, branchId, id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function findPreJobCardByRegNo(pool, companyId, branchId, regNo) {
  const { rows } = await pool.query(
    `SELECT p.* FROM garage.pre_job_card p
     WHERE p.company_id = $1 AND p.branch_id = $2
       AND UPPER(p.reg_no) = UPPER($3)
     ORDER BY p.created_at DESC LIMIT 1`,
    [companyId, branchId, regNo]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function insertPreJobCard(client, params) {
  const {
    companyId, branchId, preJcId, regNo, chassisNo, customerName,
    serviceAdvisor, bookingDate, bookingTime, kmReading, remarks,
    policeReport, warrantyRepair, totalLoss, createdBy,
  } = params;
  const { rows } = await client.query(
    `INSERT INTO garage.pre_job_card (
       company_id, branch_id, pre_jc_id, reg_no, chassis_no,
       customer_name, service_advisor, booking_date, booking_time,
       km_reading, remarks, police_report, warranty_repair, total_loss,
       status, created_by, modified_by
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       'OPEN', $15, $15
     ) RETURNING *`,
    [
      companyId, branchId, preJcId, regNo, chassisNo,
      customerName, serviceAdvisor, bookingDate, bookingTime,
      kmReading, remarks, policeReport, warrantyRepair, totalLoss,
      createdBy,
    ]
  );
  return mapRow(rows[0]);
}

export async function updatePreJobCard(pool, companyId, branchId, id, params) {
  const {
    regNo, chassisNo, customerName, serviceAdvisor, bookingDate, bookingTime,
    kmReading, remarks, policeReport, warrantyRepair, totalLoss, modifiedBy,
  } = params;
  const { rows } = await pool.query(
    `UPDATE garage.pre_job_card SET
       reg_no = $4, chassis_no = $5, customer_name = $6,
       service_advisor = $7, booking_date = $8, booking_time = $9,
       km_reading = $10, remarks = $11,
       police_report = $12, warranty_repair = $13, total_loss = $14,
       modified_at = CURRENT_TIMESTAMP, modified_by = $15
     WHERE company_id = $1 AND branch_id = $2 AND id = $3
     RETURNING *`,
    [
      companyId, branchId, id,
      regNo, chassisNo, customerName, serviceAdvisor,
      bookingDate, bookingTime, kmReading, remarks,
      policeReport, warrantyRepair, totalLoss, modifiedBy,
    ]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function linkPreJcToJobCard(client, companyId, branchId, preJcId, jobCardId) {
  await client.query(
    `UPDATE garage.pre_job_card SET job_card_id = $4, status = 'JC_CREATED'
     WHERE company_id = $1 AND branch_id = $2 AND id = $3`,
    [companyId, branchId, preJcId, jobCardId]
  );
}
