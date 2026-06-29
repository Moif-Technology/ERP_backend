import { withTransaction } from '../../config/db.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as hrRepo from '../repositories/hr.repository.js';
import { nextDocNo } from '../../shared/services/docSequence.service.js';

function parseBranchId(authStaff, branchIdQueryOrBody) {
  const candidate = branchIdQueryOrBody ?? authStaff.branch_id;
  const n = Number(candidate);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

async function resolveTenant(pool, authStaff, branchInput) {
  const companyId = Number(authStaff.company_id);
  const branchId = parseBranchId(authStaff, branchInput);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid session company');
    err.status = 401;
    throw err;
  }
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const ok = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!ok) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }
  return { companyId, branchId };
}

function optionalText(v, max = 255) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function requirePositiveInt(v, fieldName) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) {
    const err = new Error(`Valid ${fieldName} is required`);
    err.status = 400;
    throw err;
  }
  return n;
}

// ── Employees ─────────────────────────────────────────
export async function listEmployees(pool, authStaff, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  return hrRepo.listEmployees(pool, companyId, branchId);
}

export async function getEmployee(pool, authStaff, employeeId, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  const id = requirePositiveInt(employeeId, 'employeeId');
  return hrRepo.getEmployee(pool, companyId, branchId, id);
}

export async function createEmployee(pool, authStaff, body) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, body?.branchId);
  const employeeName = optionalText(body?.employeeName, 100);
  if (!employeeName) {
    const err = new Error('employeeName is required');
    err.status = 400;
    throw err;
  }
  const shiftType = optionalText(body?.shiftType, 10) || 'Regular';
  const employeeCodeInput = optionalText(body?.employeeCode, 20);
  const data = {
    companyId,
    branchId,
    employeeCode: employeeCodeInput,
    employeeName,
    shiftType,
    shiftId: body?.shiftId != null && body.shiftId !== '' ? Number(body.shiftId) : null,
    designation: optionalText(body?.designation, 80),
    department: optionalText(body?.department, 80),
    dateOfJoining: body?.dateOfJoining || null,
    dateOfBirth: body?.dateOfBirth || null,
    gender: optionalText(body?.gender, 10),
    nationality: optionalText(body?.nationality, 50),
    mobileNo: optionalText(body?.mobileNo, 20),
    email: optionalText(body?.email, 100),
    addressLine1: optionalText(body?.addressLine1, 200),
    addressLine2: optionalText(body?.addressLine2, 200),
    emiratesIdNo: optionalText(body?.emiratesIdNo, 50),
    passportNo: optionalText(body?.passportNo, 50),
    employmentType: optionalText(body?.employmentType, 30),
    workLocation: optionalText(body?.workLocation, 80),
    reportingManager: optionalText(body?.reportingManager, 100),
    payrollGroup: optionalText(body?.payrollGroup, 50),
    leavePolicy: optionalText(body?.leavePolicy, 80),
    basicSalary: body?.basicSalary != null && body.basicSalary !== '' ? Number(body.basicSalary) : null,
    bankName: optionalText(body?.bankName, 80),
    bankAccountNo: optionalText(body?.bankAccountNo, 50),
    createdBy: optionalText(authStaff.staff_name || authStaff.login_name || 'system', 50) || 'system',
  };

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `hr.employee_master:${companyId}:${branchId}`,
    ]);
    data.employeeId = await hrRepo.nextEmployeeId(client, companyId, branchId);
    data.employeeCode = data.employeeCode || await nextDocNo(client, { companyId, branchId, sequenceCode: 'EMPLOYEE' });
    return hrRepo.insertEmployee(client, data);
  });
}

export async function updateEmployee(pool, authStaff, employeeId, body) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, body?.branchId);
  const id = requirePositiveInt(employeeId, 'employeeId');
  const data = {
    companyId,
    branchId,
    employeeId: id,
    employeeName: optionalText(body?.employeeName, 100),
    shiftType: optionalText(body?.shiftType, 10),
    shiftId: body?.shiftId != null && body.shiftId !== '' ? Number(body.shiftId) : undefined,
    designation: optionalText(body?.designation, 80),
    department: optionalText(body?.department, 80),
    dateOfJoining: body?.dateOfJoining || undefined,
    dateOfBirth: body?.dateOfBirth || undefined,
    gender: optionalText(body?.gender, 10),
    nationality: optionalText(body?.nationality, 50),
    mobileNo: optionalText(body?.mobileNo, 20),
    email: optionalText(body?.email, 100),
    addressLine1: optionalText(body?.addressLine1, 200),
    addressLine2: optionalText(body?.addressLine2, 200),
    emiratesIdNo: optionalText(body?.emiratesIdNo, 50),
    passportNo: optionalText(body?.passportNo, 50),
    employmentType: optionalText(body?.employmentType, 30),
    workLocation: optionalText(body?.workLocation, 80),
    reportingManager: optionalText(body?.reportingManager, 100),
    payrollGroup: optionalText(body?.payrollGroup, 50),
    leavePolicy: optionalText(body?.leavePolicy, 80),
    basicSalary: body?.basicSalary != null && body.basicSalary !== '' ? Number(body.basicSalary) : undefined,
    bankName: optionalText(body?.bankName, 80),
    bankAccountNo: optionalText(body?.bankAccountNo, 50),
  };
  return hrRepo.updateEmployee(pool, data);
}

export async function deleteEmployee(pool, authStaff, employeeId, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  const id = requirePositiveInt(employeeId, 'employeeId');
  return hrRepo.deactivateEmployee(pool, companyId, branchId, id);
}

// ── Shifts ────────────────────────────────────────────
export async function listShifts(pool, authStaff, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  return hrRepo.listShifts(pool, companyId, branchId);
}

export async function createShift(pool, authStaff, body) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, body?.branchId);
  const shiftName = optionalText(body?.shiftName, 100);
  const shiftType = optionalText(body?.shiftType, 10);
  if (!shiftName || !shiftType) {
    const err = new Error('shiftName and shiftType are required');
    err.status = 400;
    throw err;
  }
  const data = {
    companyId,
    branchId,
    shiftName,
    shiftType,
    startTime: body?.startTime || null,
    endTime: body?.endTime || null,
    minWorkHours: Number(body?.minWorkHours ?? 0),
    lateGraceMinutes: Number(body?.lateGraceMinutes ?? 0),
    earlyGraceMinutes: Number(body?.earlyGraceMinutes ?? 0),
    autoBreakMinutes: Number(body?.autoBreakMinutes ?? 0),
    otStartAfterMinutes: Number(body?.otStartAfterMinutes ?? 0),
  };
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `hr.shift_master:${companyId}:${branchId}`,
    ]);
    data.shiftId = await hrRepo.nextShiftId(client, companyId, branchId);
    return hrRepo.insertShift(client, data);
  });
}

export async function updateShift(pool, authStaff, shiftId, body) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, body?.branchId);
  const id = requirePositiveInt(shiftId, 'shiftId');
  return hrRepo.updateShift(pool, companyId, branchId, id, {
    shiftName: optionalText(body?.shiftName, 100),
    shiftType: optionalText(body?.shiftType, 10),
    startTime: body?.startTime,
    endTime: body?.endTime,
    minWorkHours: body?.minWorkHours != null ? Number(body.minWorkHours) : undefined,
    lateGraceMinutes: body?.lateGraceMinutes != null ? Number(body.lateGraceMinutes) : undefined,
    earlyGraceMinutes: body?.earlyGraceMinutes != null ? Number(body.earlyGraceMinutes) : undefined,
    autoBreakMinutes: body?.autoBreakMinutes != null ? Number(body.autoBreakMinutes) : undefined,
    otStartAfterMinutes: body?.otStartAfterMinutes != null ? Number(body.otStartAfterMinutes) : undefined,
  });
}

export async function deleteShift(pool, authStaff, shiftId, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  const id = requirePositiveInt(shiftId, 'shiftId');
  return hrRepo.deleteShift(pool, companyId, branchId, id);
}

// ── Leave Types ───────────────────────────────────────
export async function listLeaveTypes(pool, authStaff, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  return hrRepo.listLeaveTypes(pool, companyId, branchId);
}

export async function createLeaveType(pool, authStaff, body) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, body?.branchId);
  const leaveName = optionalText(body?.leaveName, 50);
  const maxDaysPerYear = Number(body?.maxDaysPerYear ?? 0);
  if (!leaveName || !Number.isFinite(maxDaysPerYear)) {
    const err = new Error('leaveName and maxDaysPerYear are required');
    err.status = 400;
    throw err;
  }
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `hr.leave_type_master:${companyId}:${branchId}`,
    ]);
    const leaveTypeId = await hrRepo.nextLeaveTypeId(client, companyId, branchId);
    return hrRepo.insertLeaveType(client, {
      companyId,
      branchId,
      leaveTypeId,
      leaveName,
      maxDaysPerYear,
    });
  });
}

export async function updateLeaveType(pool, authStaff, leaveTypeId, body) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, body?.branchId);
  const id = requirePositiveInt(leaveTypeId, 'leaveTypeId');
  return hrRepo.updateLeaveType(pool, companyId, branchId, id, {
    leaveName: optionalText(body?.leaveName, 50),
    maxDaysPerYear: body?.maxDaysPerYear != null ? Number(body.maxDaysPerYear) : undefined,
  });
}

export async function deleteLeaveType(pool, authStaff, leaveTypeId, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  const id = requirePositiveInt(leaveTypeId, 'leaveTypeId');
  return hrRepo.deleteLeaveType(pool, companyId, branchId, id);
}

// ── Leave Requests ────────────────────────────────────
export async function listLeaveRequests(pool, authStaff, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  return hrRepo.listLeaveRequests(pool, companyId, branchId);
}

export async function createLeaveRequest(pool, authStaff, body) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, body?.branchId);
  const employeeId = Number(body?.employeeId);
  const leaveTypeId = Number(body?.leaveTypeId);
  const fromDate = body?.fromDate;
  const toDate = body?.toDate;
  const totalDays = Number(body?.totalDays ?? 0);
  const requestStatus = optionalText(body?.requestStatus, 20) || 'Pending Approval';
  if (!Number.isFinite(employeeId) || employeeId < 1 || !Number.isFinite(leaveTypeId) || leaveTypeId < 1 || !fromDate || !toDate) {
    const err = new Error('employeeId, leaveTypeId, fromDate, and toDate are required');
    err.status = 400;
    throw err;
  }
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `hr.leave_request:${companyId}:${branchId}`,
    ]);
    const leaveRequestId = await hrRepo.nextLeaveRequestId(client, companyId, branchId);
    return hrRepo.insertLeaveRequest(client, {
      companyId,
      branchId,
      leaveRequestId,
      employeeId,
      leaveTypeId,
      fromDate,
      toDate,
      totalDays: Number.isFinite(totalDays) && totalDays > 0 ? totalDays : 1,
      requestStatus,
    });
  });
}

export async function updateLeaveRequestStatus(pool, authStaff, leaveRequestId, body) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, body?.branchId);
  const id = requirePositiveInt(leaveRequestId, 'leaveRequestId');
  const requestStatus = optionalText(body?.requestStatus, 20);
  if (!requestStatus) {
    const err = new Error('requestStatus is required');
    err.status = 400;
    throw err;
  }
  const approvedBy = optionalText(authStaff.staff_name || authStaff.login_name, 100);
  return hrRepo.updateLeaveRequestStatus(pool, companyId, branchId, id, requestStatus, approvedBy);
}

// ── Attendance ────────────────────────────────────────
export async function listAttendanceDaily(pool, authStaff, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  return hrRepo.listAttendanceDaily(pool, companyId, branchId, query?.workDate || null, query?.employeeId || null);
}

export async function createAttendance(pool, authStaff, body) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, body?.branchId);
  const employeeId = requirePositiveInt(body?.employeeId, 'employeeId');
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `hr.attendance_daily:${companyId}:${branchId}`,
    ]);
    const dailyId = await hrRepo.nextDailyId(client, companyId, branchId);
    return hrRepo.insertAttendance(client, {
      companyId,
      branchId,
      dailyId,
      employeeId,
      workDate: body?.workDate || new Date().toISOString().split('T')[0],
      shiftId: body?.shiftId != null ? Number(body.shiftId) : null,
      firstIn: body?.firstIn || null,
      lastOut: body?.lastOut || null,
      otHours: body?.otHours != null ? Number(body.otHours) : 0,
      attendanceStatus: optionalText(body?.attendanceStatus, 20) || 'Present',
    });
  });
}

export async function updateAttendance(pool, authStaff, dailyId, body) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, body?.branchId);
  const id = requirePositiveInt(dailyId, 'dailyId');
  return withTransaction(async (client) => {
    const record = await hrRepo.updateAttendanceRecord(client, {
      companyId, branchId, dailyId: id,
      firstIn: body?.firstIn ?? null,
      lastOut: body?.lastOut ?? null,
      shiftId: body?.shiftId != null ? Number(body.shiftId) : null,
      otHours: body?.otHours != null ? Number(body.otHours) : null,
      attendanceStatus: optionalText(body?.attendanceStatus, 20) ?? null,
    });
    if (!record) {
      const err = new Error('Attendance record not found');
      err.status = 404;
      throw err;
    }
    return record;
  });
}

// ── Document Types ────────────────────────────────────
export async function listDocumentTypes(pool, authStaff, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  return hrRepo.listDocumentTypes(pool, companyId, branchId);
}

export async function createDocumentType(pool, authStaff, body) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, body?.branchId);
  const documentTypeName = optionalText(body?.documentTypeName, 80);
  if (!documentTypeName) {
    const err = new Error('documentTypeName is required');
    err.status = 400;
    throw err;
  }
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `hr.document_type_master:${companyId}:${branchId}`,
    ]);
    const documentTypeId = await hrRepo.nextDocumentTypeId(client, companyId, branchId);
    return hrRepo.insertDocumentType(client, {
      companyId,
      branchId,
      documentTypeId,
      documentTypeName,
      allowedExtensions: optionalText(body?.allowedExtensions, 100) || 'pdf,jpg,png',
      isRequired: body?.isRequired === true,
      reminderDays: Number(body?.reminderDays ?? 30),
    });
  });
}

export async function deleteDocumentType(pool, authStaff, documentTypeId, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  const id = requirePositiveInt(documentTypeId, 'documentTypeId');
  return hrRepo.deleteDocumentType(pool, companyId, branchId, id);
}

// ── Documents / Attachments ───────────────────────────
export async function listDocuments(pool, authStaff, employeeId, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  const empId = requirePositiveInt(employeeId, 'employeeId');
  return hrRepo.listDocuments(pool, companyId, branchId, empId);
}

export async function createDocument(pool, authStaff, employeeId, body) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, body?.branchId);
  const empId = requirePositiveInt(employeeId, 'employeeId');
  const title = optionalText(body?.title, 150);
  if (!title) {
    const err = new Error('title is required');
    err.status = 400;
    throw err;
  }
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `hr.attachment_master:${companyId}:${branchId}`,
    ]);
    const attachmentId = await hrRepo.nextAttachmentId(client, companyId, branchId);
    return hrRepo.insertDocument(client, {
      companyId,
      branchId,
      attachmentId,
      employeeId: empId,
      documentTypeId: body?.documentTypeId != null ? Number(body.documentTypeId) : null,
      title,
      fileName: optionalText(body?.fileName, 255),
      filePath: optionalText(body?.filePath, 500),
      fileSize: body?.fileSize != null ? Number(body.fileSize) : null,
      expiryDate: body?.expiryDate || null,
      remindDays: Number(body?.remindDays ?? 30),
      status: 'Valid',
      remarks: optionalText(body?.remarks, 500),
      createdBy: optionalText(authStaff.staff_name || authStaff.login_name || 'system', 50) || 'system',
    });
  });
}

export async function deleteDocument(pool, authStaff, attachmentId, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  const id = requirePositiveInt(attachmentId, 'attachmentId');
  return hrRepo.deleteDocument(pool, companyId, branchId, id);
}

// ── Leave Balances ────────────────────────────────────
export async function listLeaveBalances(pool, authStaff, employeeId, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  const empId = requirePositiveInt(employeeId, 'employeeId');
  const year = query?.year ? Number(query.year) : new Date().getFullYear();
  return hrRepo.listLeaveBalances(pool, companyId, branchId, empId, year);
}

// ── Loans ─────────────────────────────────────────────
export async function listLoans(pool, authStaff, employeeId, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  const empId = requirePositiveInt(employeeId, 'employeeId');
  return hrRepo.listLoans(pool, companyId, branchId, empId);
}

// ── Branches (read-only, reuse core.branch_master) ────
export async function listBranches(pool, authStaff) {
  const companyId = Number(authStaff.company_id);
  const { rows } = await branchRepo.listBranchesByCompany(pool, companyId);
  return rows.map((r) => ({
    branchId: Number(r.branch_id),
    branchCode: r.branch_code,
    branchName: r.branch_name,
  }));
}

// ── Departments ───────────────────────────────────────
export async function listDepartments(pool, authStaff, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  return hrRepo.listDepartments(pool, companyId, branchId);
}

export async function createDepartment(pool, authStaff, body) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, body?.branchId);
  const deptName = optionalText(body?.deptName, 80);
  if (!deptName) {
    const err = new Error('deptName is required');
    err.status = 400;
    throw err;
  }
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `hr.department_master:${companyId}:${branchId}`,
    ]);
    const deptId = await hrRepo.nextDeptId(client, companyId, branchId);
    return hrRepo.insertDepartment(client, { companyId, branchId, deptId, deptName });
  });
}

export async function deleteDepartment(pool, authStaff, deptId, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  const id = requirePositiveInt(deptId, 'deptId');
  return hrRepo.deleteDepartment(pool, companyId, branchId, id);
}

// ── Dashboard ─────────────────────────────────────────
export async function dashboardSummary(pool, authStaff, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  return hrRepo.hrSummary(pool, companyId, branchId);
}

// ── Expiring Documents ────────────────────────────────
export async function listExpiringDocuments(pool, authStaff, query) {
  const { companyId, branchId } = await resolveTenant(pool, authStaff, query?.branchId);
  const withinDays = query?.withinDays ? Number(query.withinDays) : 60;
  return hrRepo.listExpiringDocuments(pool, companyId, branchId, withinDays);
}
