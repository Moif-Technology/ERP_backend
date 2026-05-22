import { pool } from '../config/db.js';
import * as hrService from '../services/hr.service.js';

function handle(err, res, fallbackMessage) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.code === '42P01') {
    return res.status(503).json({ message: 'HR tables are not installed. Apply HR schema migrations.' });
  }
  if (err.code === '23505') {
    return res.status(409).json({ message: 'Duplicate HR record for this branch/company.' });
  }
  console.error(err);
  return res.status(500).json({ message: fallbackMessage });
}

// ── Dashboard ─────────────────────────────────────────
export async function getDashboardSummary(req, res) {
  try {
    const summary = await hrService.dashboardSummary(pool, req.authStaff, req.query);
    return res.json({ summary });
  } catch (err) {
    return handle(err, res, 'Could not load HR dashboard summary');
  }
}

// ── Employees ─────────────────────────────────────────
export async function listEmployees(req, res) {
  try {
    const employees = await hrService.listEmployees(pool, req.authStaff, req.query);
    return res.json({ employees });
  } catch (err) {
    return handle(err, res, 'Could not load employees');
  }
}

export async function getEmployee(req, res) {
  try {
    const employee = await hrService.getEmployee(pool, req.authStaff, req.params.employeeId, req.query);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    return res.json({ employee });
  } catch (err) {
    return handle(err, res, 'Could not load employee');
  }
}

export async function createEmployee(req, res) {
  try {
    const employee = await hrService.createEmployee(pool, req.authStaff, req.body);
    return res.status(201).json(employee);
  } catch (err) {
    return handle(err, res, 'Could not create employee');
  }
}

export async function updateEmployee(req, res) {
  try {
    const employee = await hrService.updateEmployee(pool, req.authStaff, req.params.employeeId, req.body);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    return res.json(employee);
  } catch (err) {
    return handle(err, res, 'Could not update employee');
  }
}

export async function deleteEmployee(req, res) {
  try {
    await hrService.deleteEmployee(pool, req.authStaff, req.params.employeeId, req.query);
    return res.json({ message: 'Employee deactivated' });
  } catch (err) {
    return handle(err, res, 'Could not delete employee');
  }
}

// ── Shifts ────────────────────────────────────────────
export async function listShifts(req, res) {
  try {
    const shifts = await hrService.listShifts(pool, req.authStaff, req.query);
    return res.json({ shifts });
  } catch (err) {
    return handle(err, res, 'Could not load shifts');
  }
}

export async function createShift(req, res) {
  try {
    const shift = await hrService.createShift(pool, req.authStaff, req.body);
    return res.status(201).json(shift);
  } catch (err) {
    return handle(err, res, 'Could not create shift');
  }
}

export async function updateShift(req, res) {
  try {
    const shift = await hrService.updateShift(pool, req.authStaff, req.params.shiftId, req.body);
    if (!shift) return res.status(404).json({ message: 'Shift not found' });
    return res.json(shift);
  } catch (err) {
    return handle(err, res, 'Could not update shift');
  }
}

export async function deleteShift(req, res) {
  try {
    await hrService.deleteShift(pool, req.authStaff, req.params.shiftId, req.query);
    return res.json({ message: 'Shift deleted' });
  } catch (err) {
    return handle(err, res, 'Could not delete shift');
  }
}

// ── Leave Types ───────────────────────────────────────
export async function listLeaveTypes(req, res) {
  try {
    const leaveTypes = await hrService.listLeaveTypes(pool, req.authStaff, req.query);
    return res.json({ leaveTypes });
  } catch (err) {
    return handle(err, res, 'Could not load leave types');
  }
}

export async function createLeaveType(req, res) {
  try {
    const leaveType = await hrService.createLeaveType(pool, req.authStaff, req.body);
    return res.status(201).json(leaveType);
  } catch (err) {
    return handle(err, res, 'Could not create leave type');
  }
}

export async function updateLeaveType(req, res) {
  try {
    const leaveType = await hrService.updateLeaveType(pool, req.authStaff, req.params.leaveTypeId, req.body);
    if (!leaveType) return res.status(404).json({ message: 'Leave type not found' });
    return res.json(leaveType);
  } catch (err) {
    return handle(err, res, 'Could not update leave type');
  }
}

export async function deleteLeaveType(req, res) {
  try {
    await hrService.deleteLeaveType(pool, req.authStaff, req.params.leaveTypeId, req.query);
    return res.json({ message: 'Leave type deleted' });
  } catch (err) {
    return handle(err, res, 'Could not delete leave type');
  }
}

// ── Leave Requests ────────────────────────────────────
export async function listLeaveRequests(req, res) {
  try {
    const leaveRequests = await hrService.listLeaveRequests(pool, req.authStaff, req.query);
    return res.json({ leaveRequests });
  } catch (err) {
    return handle(err, res, 'Could not load leave requests');
  }
}

export async function createLeaveRequest(req, res) {
  try {
    const leaveRequest = await hrService.createLeaveRequest(pool, req.authStaff, req.body);
    return res.status(201).json(leaveRequest);
  } catch (err) {
    return handle(err, res, 'Could not create leave request');
  }
}

export async function updateLeaveRequestStatus(req, res) {
  try {
    const result = await hrService.updateLeaveRequestStatus(pool, req.authStaff, req.params.leaveRequestId, req.body);
    if (!result) return res.status(404).json({ message: 'Leave request not found' });
    return res.json(result);
  } catch (err) {
    return handle(err, res, 'Could not update leave request status');
  }
}

// ── Attendance ────────────────────────────────────────
export async function listAttendanceDaily(req, res) {
  try {
    const attendance = await hrService.listAttendanceDaily(pool, req.authStaff, req.query);
    return res.json({ attendance });
  } catch (err) {
    return handle(err, res, 'Could not load attendance');
  }
}

export async function createAttendance(req, res) {
  try {
    const record = await hrService.createAttendance(pool, req.authStaff, req.body);
    return res.status(201).json(record);
  } catch (err) {
    return handle(err, res, 'Could not create attendance record');
  }
}

// ── Document Types ────────────────────────────────────
export async function listDocumentTypes(req, res) {
  try {
    const documentTypes = await hrService.listDocumentTypes(pool, req.authStaff, req.query);
    return res.json({ documentTypes });
  } catch (err) {
    return handle(err, res, 'Could not load document types');
  }
}

export async function createDocumentType(req, res) {
  try {
    const docType = await hrService.createDocumentType(pool, req.authStaff, req.body);
    return res.status(201).json(docType);
  } catch (err) {
    return handle(err, res, 'Could not create document type');
  }
}

export async function deleteDocumentType(req, res) {
  try {
    await hrService.deleteDocumentType(pool, req.authStaff, req.params.documentTypeId, req.query);
    return res.json({ message: 'Document type deleted' });
  } catch (err) {
    return handle(err, res, 'Could not delete document type');
  }
}

// ── Documents / Attachments ───────────────────────────
export async function listDocuments(req, res) {
  try {
    const documents = await hrService.listDocuments(pool, req.authStaff, req.params.employeeId, req.query);
    return res.json({ documents });
  } catch (err) {
    return handle(err, res, 'Could not load documents');
  }
}

export async function createDocument(req, res) {
  try {
    const document = await hrService.createDocument(pool, req.authStaff, req.params.employeeId, req.body);
    return res.status(201).json(document);
  } catch (err) {
    return handle(err, res, 'Could not upload document');
  }
}

export async function deleteDocument(req, res) {
  try {
    await hrService.deleteDocument(pool, req.authStaff, req.params.attachmentId, req.query);
    return res.json({ message: 'Document deleted' });
  } catch (err) {
    return handle(err, res, 'Could not delete document');
  }
}

// ── Leave Balances ────────────────────────────────────
export async function listLeaveBalances(req, res) {
  try {
    const balances = await hrService.listLeaveBalances(pool, req.authStaff, req.params.employeeId, req.query);
    return res.json({ balances });
  } catch (err) {
    return handle(err, res, 'Could not load leave balances');
  }
}

// ── Loans ─────────────────────────────────────────────
export async function listLoans(req, res) {
  try {
    const loans = await hrService.listLoans(pool, req.authStaff, req.params.employeeId, req.query);
    return res.json({ loans });
  } catch (err) {
    return handle(err, res, 'Could not load loans');
  }
}
