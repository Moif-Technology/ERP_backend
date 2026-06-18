function mapHeader(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    branchId: Number(row.branch_id),
    jcNo: row.jc_no,
    preJcId: row.pre_jc_id == null ? null : Number(row.pre_jc_id),
    vehicleId: row.vehicle_id == null ? null : Number(row.vehicle_id),
    estimationId: row.estimation_id == null ? null : Number(row.estimation_id),
    regNo: row.reg_no,
    chassisNo: row.chassis_no,
    stationCode: row.station_code,
    customerType: row.customer_type,
    vehOwnerName: row.veh_owner_name,
    customerName: row.customer_name,
    jobBroughtBy: row.job_brought_by,
    driver: row.driver,
    serviceAdvisor: row.service_advisor,
    bookingDate: row.booking_date,
    promiseDate: row.promise_date,
    kmReadingIn: row.km_reading_in == null ? null : Number(row.km_reading_in),
    jobType: row.job_type,
    estimationNo: row.estimation_no,
    estimationAmount: row.estimation_amount == null ? null : Number(row.estimation_amount),
    lpoNo: row.lpo_no,
    lpoDate: row.lpo_date,
    claimNo: row.claim_no,
    excessAmt: row.excess_amt == null ? null : Number(row.excess_amt),
    advanceReceived: row.advance_received == null ? null : Number(row.advance_received),
    invoiceParty: row.invoice_party,
    customerConcern: row.customer_concern,
    shortDesc: row.short_desc,
    repeatJob: row.repeat_job,
    jobRefNo: row.job_ref_no,
    policeRefNo: row.police_ref_no,
    policeReport: row.police_report,
    warrantyRepair: row.warranty_repair,
    totalLoss: row.total_loss,
    qcPass: row.qc_pass,
    qcDetails: row.qc_details,
    warrantyDetails: row.warranty_details,
    status: row.status,
    workflowStatus: row.workflow_status || 'OPEN_BY_ADVISOR',
    assignedSupervisorId: row.assigned_supervisor_id == null ? null : Number(row.assigned_supervisor_id),
    assignedSupervisorName: row.assigned_supervisor_name,
    assignedTechnicianId: row.assigned_technician_id == null ? null : Number(row.assigned_technician_id),
    assignedTechnicianName: row.assigned_technician_name,
    inspectionStartedAt: row.inspection_started_at,
    inspectionCompletedAt: row.inspection_completed_at,
    inspectionNotes: row.inspection_notes,
    supervisorReviewNotes: row.supervisor_review_notes,
    suggestedJobs: row.suggested_jobs,
    customerApprovalStatus: row.customer_approval_status || 'PENDING',
    customerApprovalNotes: row.customer_approval_notes,
    customerApprovedAt: row.customer_approved_at,
    workStartedAt: row.work_started_at,
    workCompletedAt: row.work_completed_at,
    customerId: row.customer_id == null ? null : Number(row.customer_id),
    linkedCustomerName: row.linked_customer_name ?? null,
    linkedCustomerCode: row.linked_customer_code ?? null,
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
    jobCardId: Number(row.job_card_id),
    lineNo: Number(row.line_no),
    jobCode: row.job_code,
    description: row.description,
    stdTime: row.std_time == null ? null : Number(row.std_time),
    unitCost: row.unit_cost == null ? null : Number(row.unit_cost),
    sellingPrice: row.selling_price == null ? null : Number(row.selling_price),
    createdAt: row.created_at,
  };
}

export async function nextJcNo(client, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(jc_no,'[^0-9]','','g'),'') AS BIGINT)), 0) + 1 AS next_seq
     FROM garage.job_card
     WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId]
  );
  const seq = String(rows[0].next_seq).padStart(5, '0');
  return `JC-${seq}`;
}

export async function listJobCards(pool, companyId, branchId, search = null, filters = {}) {
  const params = [companyId, branchId];
  let where = `WHERE j.company_id = $1 AND j.branch_id = $2`;
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (j.jc_no ILIKE $${params.length} OR COALESCE(j.reg_no,'') ILIKE $${params.length} OR COALESCE(j.customer_name,'') ILIKE $${params.length})`;
  }
  if (filters.workflowStatus) {
    params.push(filters.workflowStatus);
    where += ` AND j.workflow_status = $${params.length}`;
  }
  if (filters.workflowStatuses?.length) {
    params.push(filters.workflowStatuses);
    where += ` AND j.workflow_status = ANY($${params.length})`;
  }
  if (filters.assignedTechnicianId) {
    params.push(filters.assignedTechnicianId);
    where += ` AND j.assigned_technician_id = $${params.length}`;
  }
  if (filters.serviceAdvisor) {
    params.push(filters.serviceAdvisor);
    where += ` AND LOWER(COALESCE(j.service_advisor,'')) = LOWER($${params.length})`;
  }
  const { rows } = await pool.query(
    `SELECT j.* FROM garage.job_card j ${where} ORDER BY j.created_at DESC, j.id DESC`,
    params
  );
  return rows.map(mapHeader);
}

export async function findJobCardById(pool, companyId, branchId, id) {
  const { rows: hrows } = await pool.query(
    `SELECT jc.*,
            cm.customer_name AS linked_customer_name,
            cm.customer_code AS linked_customer_code
     FROM garage.job_card jc
     LEFT JOIN biz.customer_master cm ON cm.id = jc.customer_id
     WHERE jc.company_id = $1 AND jc.branch_id = $2 AND jc.id = $3
     LIMIT 1`,
    [companyId, branchId, id]
  );
  if (!hrows[0]) return null;
  const header = mapHeader(hrows[0]);
  const { rows: lrows } = await pool.query(
    `SELECT * FROM garage.job_card_line WHERE job_card_id = $1 ORDER BY line_no`,
    [id]
  );
  header.lines = lrows.map(mapLine);
  return header;
}

export async function insertJobCard(client, params) {
  const {
    companyId, branchId, jcNo, preJcId, vehicleId, estimationId, regNo, chassisNo, stationCode,
    customerType, vehOwnerName, customerName, jobBroughtBy, driver, serviceAdvisor,
    bookingDate, promiseDate, kmReadingIn, jobType,
    estimationNo, estimationAmount, lpoNo, lpoDate, claimNo,
    excessAmt, advanceReceived, invoiceParty,
    customerConcern, shortDesc,
    repeatJob, jobRefNo, policeRefNo,
    policeReport, warrantyRepair, totalLoss,
    qcPass, qcDetails, warrantyDetails,
    customerId,
    createdBy,
  } = params;

  const { rows } = await client.query(
    `INSERT INTO garage.job_card (
       company_id, branch_id, jc_no, pre_jc_id, vehicle_id, estimation_id, reg_no, chassis_no, station_code,
       customer_type, veh_owner_name, customer_name, job_brought_by, driver, service_advisor,
       booking_date, promise_date, km_reading_in, job_type,
       estimation_no, estimation_amount, lpo_no, lpo_date, claim_no,
       excess_amt, advance_received, invoice_party,
       customer_concern, short_desc,
       repeat_job, job_ref_no, police_ref_no,
       police_report, warranty_repair, total_loss,
       qc_pass, qc_details, warranty_details,
       customer_id,
       status, workflow_status, created_by, modified_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
       $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,
       $36,$37,$38,$39,'OPEN','OPEN_BY_ADVISOR',$40,$40
     ) RETURNING *`,
    [
      companyId, branchId, jcNo, preJcId, vehicleId, estimationId, regNo, chassisNo, stationCode,
      customerType, vehOwnerName, customerName, jobBroughtBy, driver, serviceAdvisor,
      bookingDate, promiseDate, kmReadingIn, jobType,
      estimationNo, estimationAmount, lpoNo, lpoDate, claimNo,
      excessAmt, advanceReceived, invoiceParty,
      customerConcern, shortDesc,
      repeatJob, jobRefNo, policeRefNo,
      policeReport, warrantyRepair, totalLoss,
      qcPass, qcDetails, warrantyDetails,
      customerId ?? null,
      createdBy,
    ]
  );
  return mapHeader(rows[0]);
}

export async function insertJobCardLines(client, jobCardId, companyId, lines) {
  if (!lines || lines.length === 0) return [];
  const inserted = [];
  for (let i = 0; i < lines.length; i++) {
    const { jobCode, description, stdTime, unitCost, sellingPrice } = lines[i];
    const { rows } = await client.query(
      `INSERT INTO garage.job_card_line (company_id, job_card_id, line_no, job_code, description, std_time, unit_cost, selling_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [companyId, jobCardId, i + 1, jobCode, description, stdTime ?? 0, unitCost ?? 0, sellingPrice ?? 0]
    );
    inserted.push(mapLine(rows[0]));
  }
  return inserted;
}

export async function updateJobCard(client, companyId, branchId, id, params) {
  const {
    vehicleId, estimationId, regNo, chassisNo, stationCode, customerType, vehOwnerName, customerName,
    jobBroughtBy, driver, serviceAdvisor, bookingDate, promiseDate, kmReadingIn, jobType,
    estimationNo, estimationAmount, lpoNo, lpoDate, claimNo,
    excessAmt, advanceReceived, invoiceParty,
    customerConcern, shortDesc, repeatJob, jobRefNo, policeRefNo,
    policeReport, warrantyRepair, totalLoss,
    qcPass, qcDetails, warrantyDetails, customerId, modifiedBy,
  } = params;

  const { rows } = await client.query(
    `UPDATE garage.job_card SET
       vehicle_id=$4, estimation_id=$5,
       reg_no=$6, chassis_no=$7, station_code=$8,
       customer_type=$9, veh_owner_name=$10, customer_name=$11,
       job_brought_by=$12, driver=$13, service_advisor=$14,
       booking_date=$15, promise_date=$16, km_reading_in=$17, job_type=$18,
       estimation_no=$19, estimation_amount=$20, lpo_no=$21, lpo_date=$22, claim_no=$23,
       excess_amt=$24, advance_received=$25, invoice_party=$26,
       customer_concern=$27, short_desc=$28,
       repeat_job=$29, job_ref_no=$30, police_ref_no=$31,
       police_report=$32, warranty_repair=$33, total_loss=$34,
       qc_pass=$35, qc_details=$36, warranty_details=$37,
       customer_id=$39,
       modified_at=CURRENT_TIMESTAMP, modified_by=$38
     WHERE company_id=$1 AND branch_id=$2 AND id=$3
     RETURNING *`,
    [
      companyId, branchId, id,
      vehicleId, estimationId, regNo, chassisNo, stationCode, customerType, vehOwnerName, customerName,
      jobBroughtBy, driver, serviceAdvisor, bookingDate, promiseDate, kmReadingIn, jobType,
      estimationNo, estimationAmount, lpoNo, lpoDate, claimNo,
      excessAmt, advanceReceived, invoiceParty,
      customerConcern, shortDesc, repeatJob, jobRefNo, policeRefNo,
      policeReport, warrantyRepair, totalLoss,
      qcPass, qcDetails, warrantyDetails, modifiedBy, customerId ?? null,
    ]
  );
  return rows[0] ? mapHeader(rows[0]) : null;
}

export async function replaceJobCardLines(client, jobCardId, companyId, lines) {
  await client.query(`DELETE FROM garage.job_card_line WHERE job_card_id = $1`, [jobCardId]);
  return insertJobCardLines(client, jobCardId, companyId, lines);
}

export async function setJobCardStatus(pool, companyId, branchId, id, status, modifiedBy) {
  const { rows } = await pool.query(
    `UPDATE garage.job_card SET status=$4, modified_at=CURRENT_TIMESTAMP, modified_by=$5
     WHERE company_id=$1 AND branch_id=$2 AND id=$3 RETURNING *`,
    [companyId, branchId, id, status, modifiedBy]
  );
  return rows[0] ? mapHeader(rows[0]) : null;
}

export async function insertWorkflowHistory(client, params) {
  await client.query(
    `INSERT INTO garage.job_card_status_history
       (company_id, branch_id, job_card_id, from_status, to_status, action, remarks, actor_staff_id, actor_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      params.companyId,
      params.branchId,
      params.jobCardId,
      params.fromStatus ?? null,
      params.toStatus,
      params.action,
      params.remarks ?? null,
      params.actorStaffId ?? null,
      params.actorName ?? null,
    ]
  );
}

export async function transitionWorkflow(client, companyId, branchId, id, patch, actor) {
  const current = await findJobCardById(client, companyId, branchId, id);
  if (!current) return null;
  const nextStatus = patch.workflowStatus || current.workflowStatus || 'OPEN_BY_ADVISOR';
  const { rows } = await client.query(
    `UPDATE garage.job_card SET
       workflow_status=$4::varchar,
       status=CASE WHEN $4::varchar='CLOSED' THEN 'CLOSED' WHEN status='CLOSED' THEN status ELSE status END,
       assigned_supervisor_id=COALESCE($5, assigned_supervisor_id),
       assigned_supervisor_name=COALESCE($6, assigned_supervisor_name),
       assigned_technician_id=COALESCE($7, assigned_technician_id),
       assigned_technician_name=COALESCE($8, assigned_technician_name),
       inspection_started_at=COALESCE($9, inspection_started_at),
       inspection_completed_at=COALESCE($10, inspection_completed_at),
       inspection_notes=COALESCE($11, inspection_notes),
       supervisor_review_notes=COALESCE($12, supervisor_review_notes),
       suggested_jobs=COALESCE($13, suggested_jobs),
       customer_approval_status=COALESCE($14, customer_approval_status),
       customer_approval_notes=COALESCE($15, customer_approval_notes),
       customer_approved_at=COALESCE($16, customer_approved_at),
       work_started_at=COALESCE($17, work_started_at),
       work_completed_at=COALESCE($18, work_completed_at),
       modified_at=CURRENT_TIMESTAMP,
       modified_by=$19
     WHERE company_id=$1 AND branch_id=$2 AND id=$3
     RETURNING *`,
    [
      companyId, branchId, id, nextStatus,
      patch.assignedSupervisorId ?? null,
      patch.assignedSupervisorName ?? null,
      patch.assignedTechnicianId ?? null,
      patch.assignedTechnicianName ?? null,
      patch.inspectionStartedAt ?? null,
      patch.inspectionCompletedAt ?? null,
      patch.inspectionNotes ?? null,
      patch.supervisorReviewNotes ?? null,
      patch.suggestedJobs ?? null,
      patch.customerApprovalStatus ?? null,
      patch.customerApprovalNotes ?? null,
      patch.customerApprovedAt ?? null,
      patch.workStartedAt ?? null,
      patch.workCompletedAt ?? null,
      actor.name,
    ]
  );
  if (!rows[0]) return null;
  await insertWorkflowHistory(client, {
    companyId,
    branchId,
    jobCardId: id,
    fromStatus: current.workflowStatus,
    toStatus: nextStatus,
    action: patch.action || nextStatus,
    remarks: patch.remarks,
    actorStaffId: actor.staffId,
    actorName: actor.name,
  });
  return mapHeader(rows[0]);
}

export async function deliverVehicle(pool, companyId, branchId, id, p) {
  const { rows } = await pool.query(
    `UPDATE garage.job_card
     SET status='CLOSED', delivery_date=$4, km_reading_out=$5, invoice_id=$6,
         modified_at=CURRENT_TIMESTAMP, modified_by=$7
     WHERE company_id=$1 AND branch_id=$2 AND id=$3 RETURNING *`,
    [companyId, branchId, id, p.deliveryDate, p.kmReadingOut, p.invoiceId, p.modifiedBy]
  );
  return rows[0] ? mapHeader(rows[0]) : null;
}

export async function workshopMonitor(pool, companyId, branchId, status) {
  const params = [companyId, branchId];
  let where = `WHERE jc.company_id=$1 AND jc.branch_id=$2`;
  if (status) {
    params.push(status);
    where += ` AND jc.status=$${params.length}`;
  } else {
    where += ` AND jc.status NOT IN ('CLOSED','CANCELLED')`;
  }
  const { rows } = await pool.query(
    `SELECT jc.id, jc.jc_no, jc.reg_no, jc.customer_name, jc.job_type, jc.service_advisor,
            jc.booking_date, jc.promise_date, jc.status, jc.workflow_status,
            jc.assigned_technician_id, jc.assigned_technician_name,
            jc.inspection_notes, jc.supervisor_review_notes, jc.suggested_jobs,
            jc.customer_approval_status,
            jc.qc_pass, jc.estimation_no,
            CURRENT_DATE - jc.booking_date::date AS age_days,
            (SELECT COUNT(*) FROM garage.part_request pr WHERE pr.job_card_id=jc.id AND pr.status NOT IN ('FULLY_ISSUED','CLOSED','CANCELLED')) AS pending_parts,
            (SELECT COUNT(*) FROM garage.job_code_punching p WHERE p.job_card_id=jc.id AND p.status='OPEN') AS open_punchings
     FROM garage.job_card jc
     ${where}
     ORDER BY jc.booking_date ASC, jc.id ASC`,
    params
  );
  return rows.map(r => ({
    id: Number(r.id),
    jcNo: r.jc_no,
    regNo: r.reg_no,
    customerName: r.customer_name,
    jobType: r.job_type,
    serviceAdvisor: r.service_advisor,
    bookingDate: r.booking_date,
    promiseDate: r.promise_date,
    status: r.status,
    workflowStatus: r.workflow_status,
    assignedTechnicianId: r.assigned_technician_id == null ? null : Number(r.assigned_technician_id),
    assignedTechnicianName: r.assigned_technician_name,
    inspectionNotes: r.inspection_notes,
    supervisorReviewNotes: r.supervisor_review_notes,
    suggestedJobs: r.suggested_jobs,
    customerApprovalStatus: r.customer_approval_status,
    qcPass: r.qc_pass,
    estimationNo: r.estimation_no,
    ageDays: r.age_days == null ? null : Number(r.age_days),
    pendingParts: Number(r.pending_parts ?? 0),
    openPunchings: Number(r.open_punchings ?? 0),
  }));
}
