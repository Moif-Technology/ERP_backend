import * as repo from '../repositories/posDevice.repository.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';

function toDevice(row) {
  return {
    id: Number(row.id),
    deviceToken: row.device_token,
    companyId: Number(row.company_id),
    branchId: Number(row.branch_id),
    branchName: row.branch_name ?? null,
    counterNo: Number(row.counter_no ?? 1),
    label: row.label ?? '',
    enrolledAt: row.enrolled_at,
    lastSeenAt: row.last_seen_at,
    recordStatus: row.record_status,
  };
}

function parsePositiveInt(value, fieldName) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || Math.trunc(n) !== n) {
    const err = new Error(`${fieldName} must be a positive number`);
    err.status = 400;
    throw err;
  }
  return n;
}

export async function listDevices(pool, authStaff) {
  const companyId = Number(authStaff.company_id);
  const rows = await repo.listDevices(pool, companyId);
  return rows.map(toDevice);
}

export async function updateDevice(pool, authStaff, deviceIdParam, body) {
  const companyId = Number(authStaff.company_id);
  const deviceId = parsePositiveInt(deviceIdParam, 'deviceId');
  const branchId = parsePositiveInt(body.branchId, 'branchId');
  const counterNo = parsePositiveInt(body.counterNo, 'counterNo');
  const recordStatus = String(body.recordStatus || 'ACTIVE').toUpperCase();
  if (!['ACTIVE', 'INACTIVE'].includes(recordStatus)) {
    const err = new Error('recordStatus must be ACTIVE or INACTIVE');
    err.status = 400;
    throw err;
  }
  const branchOk = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!branchOk) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }

  const updated = await repo.updateDevice(pool, {
    companyId,
    deviceId,
    label: String(body.label || '').trim() || null,
    branchId,
    counterNo,
    recordStatus,
  });
  if (!updated) {
    const err = new Error('Device not found');
    err.status = 404;
    throw err;
  }
  return toDevice(updated);
}
