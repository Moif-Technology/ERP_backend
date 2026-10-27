function asNumber(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── ID generators ─────────────────────────────────────
async function nextId(client, table, idCol, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(${idCol}), 0) + 1 AS next_id FROM hr.${table} WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId],
  );
  return Number(rows[0].next_id);
}

export const nextEmployeeId = (c, co, br) => nextId(c, 'employee_master', 'employee_id', co, br);
export const nextShiftId = (c, co, br) => nextId(c, 'shift_master', 'shift_id', co, br);
export const nextDeptId = (c, co, br) => nextId(c, 'department_master', 'dept_id', co, br);
export const nextLeaveTypeId = (c, co, br) => nextId(c, 'leave_type_master', 'leave_type_id', co, br);
export const nextLeaveRequestId = (c, co, br) => nextId(c, 'leave_request', 'leave_request_id', co, br);
export const nextDailyId = (c, co, br) => nextId(c, 'attendance_daily', 'daily_id', co, br);
export const nextDocumentTypeId = (c, co, br) => nextId(c, 'document_type_master', 'document_type_id', co, br);
export const nextAttachmentId = (c, co, br) => nextId(c, 'attachment_master', 'attachment_id', co, br);

// ── Employee ──────────────────────────────────────────
const EMP_COLS = `employee_id, employee_code, employee_name, shift_type, shift_id,
  designation, department, date_of_joining, date_of_birth, gender,
  nationality, mobile_no, email, address_line_1, address_line_2,
  emirates_id_no, passport_no, employment_type, work_location,
  reporting_manager, payroll_group, leave_policy, basic_salary,
  bank_name, bank_account_no, is_active, created_at`;

function mapEmployeeRow(r) {
  return {
    employeeId: Number(r.employee_id), employeeCode: r.employee_code,
    employeeName: r.employee_name, shiftType: r.shift_type, shiftId: asNumber(r.shift_id),
    designation: r.designation, department: r.department,
    dateOfJoining: r.date_of_joining, dateOfBirth: r.date_of_birth,
    gender: r.gender, nationality: r.nationality, mobileNo: r.mobile_no,
    email: r.email, addressLine1: r.address_line_1, addressLine2: r.address_line_2,
    emiratesIdNo: r.emirates_id_no, passportNo: r.passport_no,
    employmentType: r.employment_type, workLocation: r.work_location,
    reportingManager: r.reporting_manager, payrollGroup: r.payroll_group,
    leavePolicy: r.leave_policy, basicSalary: asNumber(r.basic_salary),
    bankName: r.bank_name, bankAccountNo: r.bank_account_no,
    isActive: r.is_active, createdAt: r.created_at,
  };
}

export async function listEmployees(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT ${EMP_COLS} FROM hr.employee_master WHERE company_id = $1 AND branch_id = $2 ORDER BY employee_name ASC`,
    [companyId, branchId],
  );
  return rows.map(mapEmployeeRow);
}

export async function getEmployee(pool, companyId, branchId, employeeId) {
  const { rows } = await pool.query(
    `SELECT ${EMP_COLS} FROM hr.employee_master WHERE company_id = $1 AND branch_id = $2 AND employee_id = $3 LIMIT 1`,
    [companyId, branchId, employeeId],
  );
  return rows[0] ? mapEmployeeRow(rows[0]) : null;
}

export async function insertEmployee(client, d) {
  const { rows } = await client.query(
    `INSERT INTO hr.employee_master (
      company_id, branch_id, employee_id, employee_code, employee_name,
      shift_type, shift_id, designation, department, date_of_joining,
      date_of_birth, gender, nationality, mobile_no, email, address_line_1,
      address_line_2, emirates_id_no, passport_no, employment_type, work_location,
      reporting_manager, payroll_group, leave_policy, basic_salary,
      bank_name, bank_account_no, is_active, created_by, created_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,TRUE,$28,NOW()
    ) RETURNING ${EMP_COLS}`,
    [d.companyId, d.branchId, d.employeeId, d.employeeCode, d.employeeName,
     d.shiftType, d.shiftId, d.designation, d.department, d.dateOfJoining,
     d.dateOfBirth, d.gender, d.nationality, d.mobileNo, d.email, d.addressLine1,
     d.addressLine2, d.emiratesIdNo, d.passportNo, d.employmentType, d.workLocation,
     d.reportingManager, d.payrollGroup, d.leavePolicy, d.basicSalary,
     d.bankName, d.bankAccountNo, d.createdBy],
  );
  return mapEmployeeRow(rows[0]);
}

export async function updateEmployee(pool, d) {
  const sets = [];
  const vals = [d.companyId, d.branchId, d.employeeId];
  let idx = 4;
  const maybe = (col, val) => {
    if (val !== undefined) { sets.push(`${col} = $${idx}`); vals.push(val); idx++; }
  };
  maybe('employee_name', d.employeeName); maybe('shift_type', d.shiftType);
  maybe('shift_id', d.shiftId); maybe('designation', d.designation);
  maybe('department', d.department); maybe('date_of_joining', d.dateOfJoining);
  maybe('date_of_birth', d.dateOfBirth); maybe('gender', d.gender);
  maybe('nationality', d.nationality); maybe('mobile_no', d.mobileNo);
  maybe('email', d.email); maybe('address_line_1', d.addressLine1);
  maybe('address_line_2', d.addressLine2); maybe('emirates_id_no', d.emiratesIdNo);
  maybe('passport_no', d.passportNo); maybe('employment_type', d.employmentType);
  maybe('work_location', d.workLocation); maybe('reporting_manager', d.reportingManager);
  maybe('payroll_group', d.payrollGroup); maybe('leave_policy', d.leavePolicy);
  maybe('basic_salary', d.basicSalary); maybe('bank_name', d.bankName);
  maybe('bank_account_no', d.bankAccountNo);
  if (!sets.length) return getEmployee(pool, d.companyId, d.branchId, d.employeeId);
  const { rows } = await pool.query(
    `UPDATE hr.employee_master SET ${sets.join(', ')} WHERE company_id=$1 AND branch_id=$2 AND employee_id=$3 RETURNING ${EMP_COLS}`,
    vals,
  );
  return rows[0] ? mapEmployeeRow(rows[0]) : null;
}

export async function deactivateEmployee(pool, companyId, branchId, employeeId) {
  await pool.query(
    `UPDATE hr.employee_master SET is_active = FALSE WHERE company_id=$1 AND branch_id=$2 AND employee_id=$3`,
    [companyId, branchId, employeeId],
  );
}

// ── Shift ─────────────────────────────────────────────
function mapShiftRow(r) {
  return {
    shiftId: Number(r.shift_id), shiftName: r.shift_name, shiftType: r.shift_type,
    startTime: r.start_time, endTime: r.end_time, minWorkHours: Number(r.min_work_hours),
    lateGraceMinutes: Number(r.late_grace_minutes), earlyGraceMinutes: Number(r.early_grace_minutes),
    autoBreakMinutes: Number(r.auto_break_minutes), otStartAfterMinutes: Number(r.ot_start_after_minutes),
  };
}

export async function listShifts(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT shift_id, shift_name, shift_type, start_time, end_time, min_work_hours,
            late_grace_minutes, early_grace_minutes, auto_break_minutes, ot_start_after_minutes
     FROM hr.shift_master WHERE company_id=$1 AND branch_id=$2 ORDER BY shift_name ASC`,
    [companyId, branchId],
  );
  return rows.map(mapShiftRow);
}

export async function insertShift(client, d) {
  const { rows } = await client.query(
    `INSERT INTO hr.shift_master (company_id,branch_id,shift_id,shift_name,shift_type,start_time,end_time,
      min_work_hours,late_grace_minutes,early_grace_minutes,auto_break_minutes,ot_start_after_minutes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING shift_id,shift_name,shift_type,start_time,end_time,min_work_hours,
               late_grace_minutes,early_grace_minutes,auto_break_minutes,ot_start_after_minutes`,
    [d.companyId,d.branchId,d.shiftId,d.shiftName,d.shiftType,d.startTime,d.endTime,
     d.minWorkHours,d.lateGraceMinutes,d.earlyGraceMinutes,d.autoBreakMinutes,d.otStartAfterMinutes],
  );
  return mapShiftRow(rows[0]);
}

export async function updateShift(pool, companyId, branchId, shiftId, d) {
  const sets = []; const vals = [companyId, branchId, shiftId]; let idx = 4;
  const maybe = (col, val) => { if (val !== undefined) { sets.push(`${col}=$${idx}`); vals.push(val); idx++; } };
  maybe('shift_name', d.shiftName); maybe('shift_type', d.shiftType);
  maybe('start_time', d.startTime); maybe('end_time', d.endTime);
  maybe('min_work_hours', d.minWorkHours); maybe('late_grace_minutes', d.lateGraceMinutes);
  maybe('early_grace_minutes', d.earlyGraceMinutes); maybe('auto_break_minutes', d.autoBreakMinutes);
  maybe('ot_start_after_minutes', d.otStartAfterMinutes);
  if (!sets.length) return null;
  const { rows } = await pool.query(
    `UPDATE hr.shift_master SET ${sets.join(',')} WHERE company_id=$1 AND branch_id=$2 AND shift_id=$3
     RETURNING shift_id,shift_name,shift_type,start_time,end_time,min_work_hours,
               late_grace_minutes,early_grace_minutes,auto_break_minutes,ot_start_after_minutes`,
    vals,
  );
  return rows[0] ? mapShiftRow(rows[0]) : null;
}

export async function deleteShift(pool, companyId, branchId, shiftId) {
  await pool.query(`DELETE FROM hr.shift_master WHERE company_id=$1 AND branch_id=$2 AND shift_id=$3`, [companyId, branchId, shiftId]);
}

// ── Leave Type ────────────────────────────────────────
function mapLeaveTypeRow(r) {
  return { leaveTypeId: Number(r.leave_type_id), leaveName: r.leave_name, maxDaysPerYear: Number(r.max_days_per_year) };
}

export async function listLeaveTypes(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT leave_type_id, leave_name, max_days_per_year FROM hr.leave_type_master WHERE company_id=$1 AND branch_id=$2 ORDER BY leave_name ASC`,
    [companyId, branchId],
  );
  return rows.map(mapLeaveTypeRow);
}

export async function insertLeaveType(client, d) {
  const { rows } = await client.query(
    `INSERT INTO hr.leave_type_master (company_id,branch_id,leave_type_id,leave_name,max_days_per_year) VALUES ($1,$2,$3,$4,$5)
     RETURNING leave_type_id, leave_name, max_days_per_year`,
    [d.companyId, d.branchId, d.leaveTypeId, d.leaveName, d.maxDaysPerYear],
  );
  return mapLeaveTypeRow(rows[0]);
}

export async function updateLeaveType(pool, companyId, branchId, leaveTypeId, d) {
  const sets = []; const vals = [companyId, branchId, leaveTypeId]; let idx = 4;
  if (d.leaveName !== undefined) { sets.push(`leave_name=$${idx}`); vals.push(d.leaveName); idx++; }
  if (d.maxDaysPerYear !== undefined) { sets.push(`max_days_per_year=$${idx}`); vals.push(d.maxDaysPerYear); idx++; }
  if (!sets.length) return null;
  const { rows } = await pool.query(
    `UPDATE hr.leave_type_master SET ${sets.join(',')} WHERE company_id=$1 AND branch_id=$2 AND leave_type_id=$3
     RETURNING leave_type_id, leave_name, max_days_per_year`, vals,
  );
  return rows[0] ? mapLeaveTypeRow(rows[0]) : null;
}

export async function deleteLeaveType(pool, companyId, branchId, leaveTypeId) {
  await pool.query(`DELETE FROM hr.leave_type_master WHERE company_id=$1 AND branch_id=$2 AND leave_type_id=$3`, [companyId, branchId, leaveTypeId]);
}

// ── Leave Request ─────────────────────────────────────
function mapLeaveRequestRow(r) {
  return {
    leaveRequestId: Number(r.leave_request_id), employeeId: Number(r.employee_id),
    employeeName: r.employee_name ?? null, leaveTypeId: Number(r.leave_type_id),
    leaveName: r.leave_name ?? null, fromDate: r.from_date, toDate: r.to_date,
    totalDays: Number(r.total_days), requestStatus: r.request_status,
  };
}

export async function listLeaveRequests(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT lr.leave_request_id, lr.employee_id, em.employee_name, lr.leave_type_id, ltm.leave_name,
            lr.from_date, lr.to_date, lr.total_days, lr.request_status
     FROM hr.leave_request lr
     LEFT JOIN hr.employee_master em ON em.company_id=lr.company_id AND em.branch_id=lr.branch_id AND em.employee_id=lr.employee_id
     LEFT JOIN hr.leave_type_master ltm ON ltm.company_id=lr.company_id AND ltm.branch_id=lr.branch_id AND ltm.leave_type_id=lr.leave_type_id
     WHERE lr.company_id=$1 AND lr.branch_id=$2 ORDER BY lr.from_date DESC, lr.leave_request_id DESC`,
    [companyId, branchId],
  );
  return rows.map(mapLeaveRequestRow);
}

export async function insertLeaveRequest(client, d) {
  const { rows } = await client.query(
    `INSERT INTO hr.leave_request (company_id,branch_id,leave_request_id,employee_id,leave_type_id,from_date,to_date,total_days,request_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING leave_request_id, employee_id, leave_type_id, from_date, to_date, total_days, request_status`,
    [d.companyId,d.branchId,d.leaveRequestId,d.employeeId,d.leaveTypeId,d.fromDate,d.toDate,d.totalDays,d.requestStatus],
  );
  return mapLeaveRequestRow(rows[0]);
}

export async function updateLeaveRequestStatus(pool, companyId, branchId, leaveRequestId, status, approvedBy) {
  const { rows } = await pool.query(
    `UPDATE hr.leave_request SET request_status=$4, approved_by=$5, approved_at=NOW()
     WHERE company_id=$1 AND branch_id=$2 AND leave_request_id=$3
     RETURNING leave_request_id, employee_id, leave_type_id, from_date, to_date, total_days, request_status`,
    [companyId, branchId, leaveRequestId, status, approvedBy],
  );
  return rows[0] ? mapLeaveRequestRow(rows[0]) : null;
}

// ── Attendance ────────────────────────────────────────
export async function listAttendanceDaily(pool, companyId, branchId, opts = {}) {
  const { workDate, fromDate, toDate, employeeId } = opts;
  const params = [companyId, branchId];
  let filter = '';
  // fromDate/toDate is the range report; workDate stays the single-day view.
  if (fromDate) { params.push(fromDate); filter += ` AND ad.work_date >= $${params.length}`; }
  if (toDate) { params.push(toDate); filter += ` AND ad.work_date <= $${params.length}`; }
  if (!fromDate && !toDate && workDate) { params.push(workDate); filter += ` AND ad.work_date = $${params.length}`; }
  if (employeeId) { params.push(Number(employeeId)); filter += ` AND ad.employee_id = $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT ad.daily_id, ad.employee_id, em.employee_name, em.department, ad.work_date,
            ad.shift_id, sm.shift_name,
            -- first_in/last_out are 'timestamp without time zone' holding branch-local
            -- wall clock. Sent as text so neither node-pg nor the browser re-zones them.
            to_char(ad.first_in,  'YYYY-MM-DD HH24:MI:SS') AS first_in,
            to_char(ad.last_out, 'YYYY-MM-DD HH24:MI:SS') AS last_out,
            ad.ot_hours, ad.attendance_status,
            ad.source, ad.device_pin
     FROM hr.attendance_daily ad
     LEFT JOIN hr.employee_master em ON em.company_id=ad.company_id AND em.branch_id=ad.branch_id AND em.employee_id=ad.employee_id
     LEFT JOIN hr.shift_master sm ON sm.company_id=ad.company_id AND sm.branch_id=ad.branch_id AND sm.shift_id=ad.shift_id
     WHERE ad.company_id=$1 AND ad.branch_id=$2${filter}
     ORDER BY ad.work_date DESC, em.employee_name ASC`, params,
  );
  return rows.map((r) => ({
    dailyId: Number(r.daily_id), employeeId: Number(r.employee_id),
    employeeName: r.employee_name ?? null, department: r.department ?? null,
    workDate: r.work_date,
    shiftId: r.shift_id != null ? Number(r.shift_id) : null,
    shiftName: r.shift_name ?? null,
    checkIn: r.first_in, checkOut: r.last_out,
    overtimeHours: r.ot_hours != null ? Number(r.ot_hours) : 0,
    attendanceStatus: r.attendance_status,
    source: r.source ?? 'manual',
    devicePin: r.device_pin ?? null,
  }));
}

export async function insertAttendance(client, d) {
  const { rows } = await client.query(
    `INSERT INTO hr.attendance_daily (company_id,branch_id,daily_id,employee_id,work_date,shift_id,first_in,last_out,ot_hours,attendance_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING daily_id, employee_id, work_date, shift_id, first_in, last_out, ot_hours, attendance_status`,
    [d.companyId,d.branchId,d.dailyId,d.employeeId,d.workDate,d.shiftId,d.firstIn,d.lastOut,d.otHours,d.attendanceStatus],
  );
  const r = rows[0];
  return { dailyId: Number(r.daily_id), employeeId: Number(r.employee_id), workDate: r.work_date, attendanceStatus: r.attendance_status };
}

export async function updateAttendanceRecord(client, d) {
  const { rows } = await client.query(
    `UPDATE hr.attendance_daily
     SET first_in          = COALESCE($3, first_in),
         last_out          = COALESCE($4, last_out),
         shift_id          = COALESCE($5, shift_id),
         ot_hours          = COALESCE($6, ot_hours),
         attendance_status = COALESCE($7, attendance_status)
     WHERE company_id=$1 AND branch_id=$2 AND daily_id=$8
     RETURNING daily_id, employee_id, work_date, first_in, last_out, ot_hours, attendance_status`,
    [d.companyId, d.branchId, d.firstIn ?? null, d.lastOut ?? null, d.shiftId ?? null, d.otHours ?? null, d.attendanceStatus ?? null, d.dailyId],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return { dailyId: Number(r.daily_id), employeeId: Number(r.employee_id), workDate: r.work_date, checkIn: r.first_in, checkOut: r.last_out, attendanceStatus: r.attendance_status };
}

// ── Document Type ─────────────────────────────────────
function mapDocTypeRow(r) {
  return {
    documentTypeId: Number(r.document_type_id), documentTypeName: r.document_type_name,
    allowedExtensions: r.allowed_extensions, isRequired: r.is_required, reminderDays: Number(r.reminder_days),
  };
}

export async function listDocumentTypes(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT document_type_id, document_type_name, allowed_extensions, is_required, reminder_days
     FROM hr.document_type_master WHERE company_id=$1 AND branch_id=$2 ORDER BY document_type_name ASC`,
    [companyId, branchId],
  );
  return rows.map(mapDocTypeRow);
}

export async function insertDocumentType(client, d) {
  const { rows } = await client.query(
    `INSERT INTO hr.document_type_master (company_id,branch_id,document_type_id,document_type_name,allowed_extensions,is_required,reminder_days)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING document_type_id, document_type_name, allowed_extensions, is_required, reminder_days`,
    [d.companyId,d.branchId,d.documentTypeId,d.documentTypeName,d.allowedExtensions,d.isRequired,d.reminderDays],
  );
  return mapDocTypeRow(rows[0]);
}

export async function deleteDocumentType(pool, companyId, branchId, documentTypeId) {
  await pool.query(`DELETE FROM hr.document_type_master WHERE company_id=$1 AND branch_id=$2 AND document_type_id=$3`, [companyId, branchId, documentTypeId]);
}

// ── Document / Attachment ─────────────────────────────
function mapDocRow(r) {
  return {
    attachmentId: Number(r.attachment_id), employeeId: Number(r.employee_id),
    documentTypeId: asNumber(r.document_type_id), documentTypeName: r.document_type_name ?? null,
    title: r.title, fileName: r.file_name, expiryDate: r.expiry_date,
    remindDays: Number(r.remind_days ?? 30), status: r.status, createdAt: r.created_at,
  };
}

export async function listDocuments(pool, companyId, branchId, employeeId) {
  const { rows } = await pool.query(
    `SELECT a.attachment_id, a.employee_id, a.document_type_id, dt.document_type_name,
            a.title, a.file_name, a.expiry_date, a.remind_days, a.status, a.created_at
     FROM hr.attachment_master a
     LEFT JOIN hr.document_type_master dt ON dt.company_id=a.company_id AND dt.branch_id=a.branch_id AND dt.document_type_id=a.document_type_id
     WHERE a.company_id=$1 AND a.branch_id=$2 AND a.employee_id=$3
     ORDER BY a.created_at DESC`,
    [companyId, branchId, employeeId],
  );
  return rows.map(mapDocRow);
}

export async function insertDocument(client, d) {
  const { rows } = await client.query(
    `INSERT INTO hr.attachment_master (company_id,branch_id,attachment_id,employee_id,document_type_id,title,file_name,file_path,file_size,expiry_date,remind_days,status,remarks,created_by,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
     RETURNING attachment_id, employee_id, document_type_id, title, file_name, expiry_date, remind_days, status, created_at`,
    [d.companyId,d.branchId,d.attachmentId,d.employeeId,d.documentTypeId,d.title,d.fileName,d.filePath,d.fileSize,d.expiryDate,d.remindDays,d.status,d.remarks,d.createdBy],
  );
  return mapDocRow(rows[0]);
}

export async function deleteDocument(pool, companyId, branchId, attachmentId) {
  await pool.query(`DELETE FROM hr.attachment_master WHERE company_id=$1 AND branch_id=$2 AND attachment_id=$3`, [companyId, branchId, attachmentId]);
}

export async function listExpiringDocuments(pool, companyId, branchId, withinDays = 60) {
  const { rows } = await pool.query(
    `SELECT a.attachment_id,
            em.employee_name,
            COALESCE(dt.document_type_name, a.title) AS document_type_name,
            a.title,
            a.expiry_date,
            (a.expiry_date - CURRENT_DATE)::int AS days_left
     FROM hr.attachment_master a
     LEFT JOIN hr.employee_master em
       ON em.company_id = a.company_id AND em.branch_id = a.branch_id
       AND a.reference_table = 'hr.employee_master'
       AND em.employee_id = a.reference_id::int
     LEFT JOIN hr.document_type_master dt
       ON dt.company_id = a.company_id AND dt.branch_id = a.branch_id AND dt.document_type_id = a.document_type_id
     WHERE a.company_id = $1 AND a.branch_id = $2
       AND a.expiry_date IS NOT NULL
       AND a.expiry_date <= (CURRENT_DATE + ($3 || ' day')::interval)
     ORDER BY a.expiry_date ASC
     LIMIT 50`,
    [companyId, branchId, withinDays],
  );
  return rows.map((r) => ({
    id: String(r.attachment_id),
    employeeName: r.employee_name || 'Unknown',
    type: r.document_type_name || 'Document',
    title: r.title,
    expiryDate: r.expiry_date,
    daysLeft: Number(r.days_left),
    severity: Number(r.days_left) <= 30 ? 'High' : 'Medium',
  }));
}

// ── Leave Balance ─────────────────────────────────────
export async function listLeaveBalances(pool, companyId, branchId, employeeId, year) {
  const { rows } = await pool.query(
    `SELECT
       ltm.leave_type_id,
       ltm.leave_name,
       ltm.max_days_per_year AS entitled_days,
       COALESCE(SUM(lr.total_days) FILTER (
         WHERE lr.request_status = 'Approved'
           AND EXTRACT(YEAR FROM lr.from_date) = $4
       ), 0)::int AS used_days,
       COALESCE(lb.carried_forward, 0)::int AS carried_forward
     FROM hr.leave_type_master ltm
     LEFT JOIN hr.leave_request lr
       ON lr.company_id = $1 AND lr.branch_id = $2
       AND lr.employee_id = $3 AND lr.leave_type_id = ltm.leave_type_id
     LEFT JOIN hr.leave_balance lb
       ON lb.company_id = $1 AND lb.branch_id = $2
       AND lb.employee_id = $3 AND lb.leave_type_id = ltm.leave_type_id AND lb.year = $4
     WHERE ltm.company_id = $1 AND ltm.branch_id = $2
     GROUP BY ltm.leave_type_id, ltm.leave_name, ltm.max_days_per_year, lb.carried_forward
     ORDER BY ltm.leave_name ASC`,
    [companyId, branchId, employeeId, year],
  );
  return rows.map((r) => {
    const entitled = Number(r.entitled_days);
    const used = Number(r.used_days);
    const carried = Number(r.carried_forward);
    return {
      leaveTypeId: Number(r.leave_type_id),
      leaveName: r.leave_name ?? `Type #${r.leave_type_id}`,
      entitledDays: entitled,
      usedDays: used,
      carriedForward: carried,
      remainingDays: Math.max(0, entitled + carried - used),
    };
  });
}

// ── Loans ─────────────────────────────────────────────
export async function listLoans(pool, companyId, branchId, employeeId) {
  const { rows } = await pool.query(
    `SELECT loan_id, loan_type, amount, balance, deduction, deduction_label, loan_status
     FROM hr.loan_master WHERE company_id=$1 AND branch_id=$2 AND employee_id=$3
     ORDER BY created_at DESC`,
    [companyId, branchId, employeeId],
  );
  return rows.map((r) => ({
    loanId: Number(r.loan_id), loanType: r.loan_type,
    amount: Number(r.amount), balance: Number(r.balance),
    deduction: Number(r.deduction), deductionLabel: r.deduction_label,
    loanStatus: r.loan_status,
  }));
}

// ── Department Master ─────────────────────────────────
export async function listDepartments(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT dept_id, dept_name FROM hr.department_master WHERE company_id=$1 AND branch_id=$2 ORDER BY dept_name ASC`,
    [companyId, branchId],
  );
  return rows.map((r) => ({ deptId: Number(r.dept_id), deptName: r.dept_name }));
}

export async function insertDepartment(client, d) {
  const { rows } = await client.query(
    `INSERT INTO hr.department_master (company_id, branch_id, dept_id, dept_name)
     VALUES ($1, $2, $3, $4) RETURNING dept_id, dept_name`,
    [d.companyId, d.branchId, d.deptId, d.deptName],
  );
  return { deptId: Number(rows[0].dept_id), deptName: rows[0].dept_name };
}

export async function deleteDepartment(pool, companyId, branchId, deptId) {
  await pool.query(
    `DELETE FROM hr.department_master WHERE company_id=$1 AND branch_id=$2 AND dept_id=$3`,
    [companyId, branchId, deptId],
  );
}

// ── Dashboard Summary ─────────────────────────────────
export async function hrSummary(pool, companyId, branchId) {
  const [employees, leaveQueue, docs, attendanceIssues] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active
       FROM hr.employee_master WHERE company_id=$1 AND branch_id=$2`, [companyId, branchId],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS pending FROM hr.leave_request
       WHERE company_id=$1 AND branch_id=$2 AND request_status ILIKE 'Pending%'`, [companyId, branchId],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS expiring_docs FROM hr.attachment_master
       WHERE company_id=$1 AND branch_id=$2 AND expiry_date IS NOT NULL AND expiry_date <= (CURRENT_DATE + INTERVAL '30 day')`,
      [companyId, branchId],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS issues FROM hr.attendance_daily
       WHERE company_id=$1 AND branch_id=$2 AND attendance_status IN ('Absent','Late In','Early Out','Missing')`,
      [companyId, branchId],
    ),
  ]);
  const [recentLeaves, todayAttendance] = await Promise.all([
    pool.query(
      `SELECT lr.leave_request_id, em.employee_name, lt.leave_name,
              lr.from_date, lr.to_date, lr.total_days, lr.request_status
         FROM hr.leave_request lr
         LEFT JOIN hr.employee_master em
           ON em.company_id = lr.company_id AND em.branch_id = lr.branch_id AND em.employee_id = lr.employee_id
         LEFT JOIN hr.leave_type_master lt
           ON lt.company_id = lr.company_id AND lt.branch_id = lr.branch_id AND lt.leave_type_id = lr.leave_type_id
        WHERE lr.company_id=$1 AND lr.branch_id=$2
        ORDER BY lr.created_at DESC
        LIMIT 5`,
      [companyId, branchId],
    ),
    pool.query(
      `SELECT em.employee_name, em.department, ad.first_in, ad.attendance_status
         FROM hr.attendance_daily ad
         LEFT JOIN hr.employee_master em
           ON em.company_id = ad.company_id AND em.branch_id = ad.branch_id AND em.employee_id = ad.employee_id
        WHERE ad.company_id=$1 AND ad.branch_id=$2 AND ad.work_date = CURRENT_DATE
        ORDER BY ad.first_in ASC NULLS LAST
        LIMIT 8`,
      [companyId, branchId],
    ),
  ]);

  return {
    totalEmployees: employees.rows[0]?.total ?? 0, activeEmployees: employees.rows[0]?.active ?? 0,
    pendingLeaves: leaveQueue.rows[0]?.pending ?? 0, expiringDocuments: docs.rows[0]?.expiring_docs ?? 0,
    attendanceIssues: attendanceIssues.rows[0]?.issues ?? 0,
    recentLeaveRequests: recentLeaves.rows.map((r) => ({
      id: r.leave_request_id,
      employeeName: r.employee_name,
      leaveType: r.leave_name,
      fromDate: r.from_date,
      toDate: r.to_date,
      totalDays: Number(r.total_days || 0),
      status: r.request_status,
    })),
    todayAttendance: todayAttendance.rows.map((r) => ({
      employeeName: r.employee_name,
      department: r.department,
      firstIn: r.first_in,
      status: r.attendance_status,
    })),
  };
}
