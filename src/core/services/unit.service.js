import { withTransaction } from '../../config/db.js';
import * as unitRepo from '../repositories/unit.repository.js';

export async function listUnits(pool, authStaff) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid session company');
    err.status = 401;
    throw err;
  }

  const count = await unitRepo.countUnitsByCompany(pool, companyId);
  if (count === 0) {
    const actor = String(authStaff.staff_name || authStaff.login_name || 'system').slice(0, 50);
    await unitRepo.seedDefaultUnits(pool, companyId, actor);
  }

  return unitRepo.listUnitsByCompany(pool, companyId);
}

export async function createUnit(pool, body, authStaff) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid session company'); err.status = 401; throw err;
  }
  const unitCode = String(body.unitCode ?? '').trim().toUpperCase().slice(0, 20);
  if (!unitCode) { const err = new Error('unitCode is required'); err.status = 400; throw err; }
  const unitName = String(body.unitName ?? '').trim().slice(0, 100);
  if (!unitName) { const err = new Error('unitName is required'); err.status = 400; throw err; }

  return withTransaction(async (client) => {
    const exists = await unitRepo.unitCodeExists(client, companyId, unitCode);
    if (exists) { const err = new Error('Unit code already exists'); err.status = 409; throw err; }
    const unitId = await unitRepo.nextUnitId(client, companyId);
    const actor = String(authStaff.staff_name || authStaff.login_name || 'system').slice(0, 50);
    const row = await unitRepo.insertUnit(client, { companyId, unitId, unitCode, unitName, createdBy: actor });
    return { unitId: Number(row.unit_id), companyId, unitCode: row.unit_code, unitName: row.unit_name };
  });
}

export async function updateUnit(pool, unitId, body, authStaff) {
  const companyId = Number(authStaff.company_id);
  const uid = Number(unitId);
  if (!Number.isFinite(uid) || uid < 1) { const err = new Error('Invalid unitId'); err.status = 400; throw err; }
  const unitCode = String(body.unitCode ?? '').trim().toUpperCase().slice(0, 20);
  if (!unitCode) { const err = new Error('unitCode is required'); err.status = 400; throw err; }
  const unitName = String(body.unitName ?? '').trim().slice(0, 100);
  if (!unitName) { const err = new Error('unitName is required'); err.status = 400; throw err; }

  return withTransaction(async (client) => {
    const exists = await unitRepo.unitCodeExists(client, companyId, unitCode, uid);
    if (exists) { const err = new Error('Unit code already exists'); err.status = 409; throw err; }
    const row = await unitRepo.updateUnit(client, { companyId, unitId: uid, unitCode, unitName });
    if (!row) { const err = new Error('Unit not found'); err.status = 404; throw err; }
    return { unitId: Number(row.unit_id), companyId, unitCode: row.unit_code, unitName: row.unit_name };
  });
}

export async function deleteUnit(pool, unitId, authStaff) {
  const companyId = Number(authStaff.company_id);
  const uid = Number(unitId);
  if (!Number.isFinite(uid) || uid < 1) { const err = new Error('Invalid unitId'); err.status = 400; throw err; }
  return withTransaction(async (client) => {
    const deleted = await unitRepo.softDeleteUnit(client, companyId, uid);
    if (!deleted) { const err = new Error('Unit not found'); err.status = 404; throw err; }
    return { deleted: true };
  });
}
