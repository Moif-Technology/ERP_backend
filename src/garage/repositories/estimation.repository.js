function mapHeader(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    branchId: Number(row.branch_id),
    estimationNo: row.estimation_no,
    estimationDate: row.estimation_date,
    jobCardId: row.job_card_id == null ? null : Number(row.job_card_id),
    jobCardNo: row.jc_no ?? null,
    vehicleId: row.vehicle_id == null ? null : Number(row.vehicle_id),
    carGroupName: row.car_group_name ?? null,
    carSubGroupName: row.car_sub_group_name ?? null,
    customerId: row.customer_id == null ? null : Number(row.customer_id),
    regNo: row.reg_no,
    chassisNo: row.chassis_no,
    customerName: row.customer_name,
    contactPerson: row.contact_person,
    customerRefNo: row.customer_ref_no,
    claimType: row.claim_type,
    estimator: row.estimator,
    model: row.model,
    bodyColour: row.body_colour,
    kmReading: row.km_reading == null ? null : Number(row.km_reading),
    totalRepairs: Number(row.total_repairs ?? 0),
    totalSpares: Number(row.total_spares ?? 0),
    discount: Number(row.discount ?? 0),
    vat: Number(row.vat ?? 0),
    estimationAmount: Number(row.estimation_amount ?? 0),
    approvalAmount: Number(row.approval_amount ?? 0),
    lpoClaimNo: row.lpo_claim_no,
    estimationStatus: row.estimation_status,
    remark: row.remark,
    additionalEstimation: row.additional_estimation,
    totalLoss: row.total_loss,
    status: row.status,
    createdAt: row.created_at,
    createdBy: row.created_by,
    modifiedAt: row.modified_at,
    modifiedBy: row.modified_by,
  };
}

function mapLine(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    estimationId: Number(row.estimation_id),
    lineNo: Number(row.line_no),
    lineType: row.line_type,
    description: row.description,
    qty: Number(row.qty ?? 0),
    rate: Number(row.rate ?? 0),
    amount: Number(row.amount ?? 0),
    spareType: row.spare_type,
    createdAt: row.created_at,
  };
}

export async function nextEstimationNo(client, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(estimation_no,'[^0-9]','','g'),'') AS BIGINT)), 0) + 1 AS next_seq
     FROM garage.estimation
     WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId]
  );
  return `EST-${String(rows[0].next_seq).padStart(5, '0')}`;
}

export async function listEstimations(pool, companyId, branchId, search = null) {
  const params = [companyId, branchId];
  let where = `WHERE e.company_id = $1 AND e.branch_id = $2`;
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (
      e.estimation_no ILIKE $3
      OR COALESCE(e.reg_no,'') ILIKE $3
      OR COALESCE(e.customer_name,'') ILIKE $3
      OR COALESCE(j.jc_no,'') ILIKE $3
    )`;
  }
  const { rows } = await pool.query(
    `SELECT e.*, j.jc_no, cg.car_group_name, sg.car_sub_group_name
     FROM garage.estimation e
     LEFT JOIN garage.job_card j ON j.id = e.job_card_id
     LEFT JOIN garage.vehicle_master vm
       ON vm.company_id = e.company_id
      AND vm.branch_id = e.branch_id
      AND vm.vehicle_id = e.vehicle_id
     LEFT JOIN garage.car_group cg
       ON cg.company_id = vm.company_id
      AND cg.car_group_id = vm.car_group_id
     LEFT JOIN garage.car_sub_group sg
       ON sg.company_id = vm.company_id
      AND sg.car_sub_group_id = vm.car_subgroup_id
     ${where}
     ORDER BY e.created_at DESC, e.id DESC`,
    params
  );
  return rows.map(mapHeader);
}

export async function findEstimationById(pool, companyId, branchId, id) {
  const { rows: hrows } = await pool.query(
    `SELECT e.*, j.jc_no, cg.car_group_name, sg.car_sub_group_name
     FROM garage.estimation e
     LEFT JOIN garage.job_card j ON j.id = e.job_card_id
     LEFT JOIN garage.vehicle_master vm
       ON vm.company_id = e.company_id
      AND vm.branch_id = e.branch_id
      AND vm.vehicle_id = e.vehicle_id
     LEFT JOIN garage.car_group cg
       ON cg.company_id = vm.company_id
      AND cg.car_group_id = vm.car_group_id
     LEFT JOIN garage.car_sub_group sg
       ON sg.company_id = vm.company_id
      AND sg.car_sub_group_id = vm.car_subgroup_id
     WHERE e.company_id = $1 AND e.branch_id = $2 AND e.id = $3
     LIMIT 1`,
    [companyId, branchId, id]
  );
  if (!hrows[0]) return null;
  const header = mapHeader(hrows[0]);
  const { rows: lrows } = await pool.query(
    `SELECT * FROM garage.estimation_line WHERE estimation_id = $1 ORDER BY line_no`,
    [id]
  );
  header.lines = lrows.map(mapLine);
  return header;
}

export async function insertEstimation(client, params) {
  const {
    companyId, branchId, estimationNo, estimationDate, jobCardId, vehicleId,
    customerId, regNo, chassisNo, customerName, contactPerson, customerRefNo,
    claimType, estimator, model, bodyColour, kmReading, totalRepairs,
    totalSpares, discount, vat, estimationAmount, approvalAmount, lpoClaimNo,
    estimationStatus, remark, additionalEstimation, totalLoss, createdBy,
  } = params;

  const { rows } = await client.query(
    `INSERT INTO garage.estimation (
       company_id, branch_id, estimation_no, estimation_date, job_card_id, vehicle_id,
       customer_id, reg_no, chassis_no, customer_name, contact_person, customer_ref_no,
       claim_type, estimator, model, body_colour, km_reading, total_repairs,
       total_spares, discount, vat, estimation_amount, approval_amount, lpo_claim_no,
       estimation_status, remark, additional_estimation, total_loss, status, created_by, modified_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
       $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,'OPEN',$29,$29
     ) RETURNING *`,
    [
      companyId, branchId, estimationNo, estimationDate, jobCardId, vehicleId,
      customerId, regNo, chassisNo, customerName, contactPerson, customerRefNo,
      claimType, estimator, model, bodyColour, kmReading, totalRepairs,
      totalSpares, discount, vat, estimationAmount, approvalAmount, lpoClaimNo,
      estimationStatus, remark, additionalEstimation, totalLoss, createdBy,
    ]
  );
  return mapHeader(rows[0]);
}

export async function insertEstimationLines(client, estimationId, companyId, lines) {
  if (!lines || lines.length === 0) return [];
  const inserted = [];
  for (let i = 0; i < lines.length; i++) {
    const { lineType, description, qty, rate, amount, spareType } = lines[i];
    const { rows } = await client.query(
      `INSERT INTO garage.estimation_line (
         company_id, estimation_id, line_no, line_type, description, qty, rate, amount, spare_type
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [companyId, estimationId, i + 1, lineType, description, qty, rate, amount, spareType]
    );
    inserted.push(mapLine(rows[0]));
  }
  return inserted;
}

export async function updateEstimation(client, companyId, branchId, id, params) {
  const {
    estimationDate, jobCardId, vehicleId, customerId, regNo, chassisNo, customerName,
    contactPerson, customerRefNo, claimType, estimator, model, bodyColour, kmReading,
    totalRepairs, totalSpares, discount, vat, estimationAmount, approvalAmount,
    lpoClaimNo, estimationStatus, remark, additionalEstimation, totalLoss, modifiedBy,
  } = params;

  const { rows } = await client.query(
    `UPDATE garage.estimation SET
       estimation_date=$4, job_card_id=$5, vehicle_id=$6, customer_id=$7,
       reg_no=$8, chassis_no=$9, customer_name=$10, contact_person=$11,
       customer_ref_no=$12, claim_type=$13, estimator=$14, model=$15,
       body_colour=$16, km_reading=$17, total_repairs=$18, total_spares=$19,
       discount=$20, vat=$21, estimation_amount=$22, approval_amount=$23,
       lpo_claim_no=$24, estimation_status=$25, remark=$26,
       additional_estimation=$27, total_loss=$28,
       modified_at=CURRENT_TIMESTAMP, modified_by=$29
     WHERE company_id=$1 AND branch_id=$2 AND id=$3
     RETURNING *`,
    [
      companyId, branchId, id, estimationDate, jobCardId, vehicleId, customerId,
      regNo, chassisNo, customerName, contactPerson, customerRefNo, claimType,
      estimator, model, bodyColour, kmReading, totalRepairs, totalSpares,
      discount, vat, estimationAmount, approvalAmount, lpoClaimNo, estimationStatus,
      remark, additionalEstimation, totalLoss, modifiedBy,
    ]
  );
  return rows[0] ? mapHeader(rows[0]) : null;
}

export async function replaceEstimationLines(client, estimationId, companyId, lines) {
  await client.query(`DELETE FROM garage.estimation_line WHERE estimation_id = $1`, [estimationId]);
  return insertEstimationLines(client, estimationId, companyId, lines);
}

export async function setEstimationStatus(pool, companyId, branchId, id, status, modifiedBy) {
  const { rows } = await pool.query(
    `UPDATE garage.estimation SET status=$4, modified_at=CURRENT_TIMESTAMP, modified_by=$5
     WHERE company_id=$1 AND branch_id=$2 AND id=$3 RETURNING *`,
    [companyId, branchId, id, status, modifiedBy]
  );
  return rows[0] ? mapHeader(rows[0]) : null;
}

export async function linkJobCardEstimation(client, companyId, branchId, jobCardId, estimationId, estimationNo, estimationAmount, vehicleId) {
  if (!jobCardId) return null;
  const { rows } = await client.query(
    `UPDATE garage.job_card
     SET estimation_id=$4,
         estimation_no=$5,
         estimation_amount=$6,
         vehicle_id=COALESCE($7, vehicle_id),
         modified_at=CURRENT_TIMESTAMP
     WHERE company_id=$1 AND branch_id=$2 AND id=$3
     RETURNING *`,
    [companyId, branchId, jobCardId, estimationId, estimationNo, estimationAmount, vehicleId]
  );
  return rows[0] || null;
}
