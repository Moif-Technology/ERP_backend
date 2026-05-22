import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/entitlementMiddleware.js';
import * as hrController from '../controllers/hr.controller.js';

export const hrRouter = Router();

hrRouter.use(authMiddleware);
hrRouter.use(requireFeature('hr'));

// Dashboard
hrRouter.get('/dashboard-summary', hrController.getDashboardSummary);

// Employees
hrRouter.get('/employees', hrController.listEmployees);
hrRouter.get('/employees/:employeeId', hrController.getEmployee);
hrRouter.post('/employees', hrController.createEmployee);
hrRouter.put('/employees/:employeeId', hrController.updateEmployee);
hrRouter.delete('/employees/:employeeId', hrController.deleteEmployee);

// Employee Documents
hrRouter.get('/employees/:employeeId/documents', hrController.listDocuments);
hrRouter.post('/employees/:employeeId/documents', hrController.createDocument);

// Employee Leave Balances
hrRouter.get('/employees/:employeeId/leave-balances', hrController.listLeaveBalances);

// Employee Loans
hrRouter.get('/employees/:employeeId/loans', hrController.listLoans);

// Shifts
hrRouter.get('/shifts', hrController.listShifts);
hrRouter.post('/shifts', hrController.createShift);
hrRouter.put('/shifts/:shiftId', hrController.updateShift);
hrRouter.delete('/shifts/:shiftId', hrController.deleteShift);

// Leave Types
hrRouter.get('/leave-types', hrController.listLeaveTypes);
hrRouter.post('/leave-types', hrController.createLeaveType);
hrRouter.put('/leave-types/:leaveTypeId', hrController.updateLeaveType);
hrRouter.delete('/leave-types/:leaveTypeId', hrController.deleteLeaveType);

// Leave Requests
hrRouter.get('/leave-requests', hrController.listLeaveRequests);
hrRouter.post('/leave-requests', hrController.createLeaveRequest);
hrRouter.patch('/leave-requests/:leaveRequestId/status', hrController.updateLeaveRequestStatus);

// Attendance
hrRouter.get('/attendance/daily', hrController.listAttendanceDaily);
hrRouter.post('/attendance/daily', hrController.createAttendance);

// Document Types
hrRouter.get('/document-types', hrController.listDocumentTypes);
hrRouter.post('/document-types', hrController.createDocumentType);
hrRouter.delete('/document-types/:documentTypeId', hrController.deleteDocumentType);

// Documents (standalone)
hrRouter.delete('/documents/:attachmentId', hrController.deleteDocument);
