import { withTransaction } from '../../config/db.js';
import * as vanRepo from '../repositories/vanMaster.repository.js';

function trim(v) {
  if (v == null) return '';
  return String(v).trim();
}

function authContext(authStaff) {
  return {
    companyId: Number(authStaff.company_id),
    branchId: authStaff.branch_id != null ? Number(authStaff.branch_id) : null,
    actor: String(authStaff.staff_id ?? 'system'),
  };
}

export async function listVans(pool, authStaff) {
  const { companyId } = authContext(authStaff);
  return vanRepo.listVans(pool, companyId);
}

export async function createVan(pool, body, authStaff) {
  const { companyId, branchId, actor } = authContext(authStaff);

  const vanCode = trim(body.vanCode);
  if (!vanCode) {
    const err = new Error('vanCode is required');
    err.status = 400;
    throw err;
  }

  const vanName = trim(body.vanName);
  if (!vanName) {
    const err = new Error('vanName is required');
    err.status = 400;
    throw err;
  }

  const plateNo = trim(body.plateNo) || null;

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `ops.van_master:${companyId}`,
    ]);
    const vanId = await vanRepo.nextVanId(client, companyId);
    return vanRepo.insertVan(client, { companyId, branchId, vanId, vanCode, vanName, plateNo, actor });
  });
}

export async function updateVan(pool, vanId, body, authStaff) {
  const { companyId, actor } = authContext(authStaff);
  const id = Number(vanId);
  if (!Number.isFinite(id) || id < 1) {
    const err = new Error('Invalid vanId');
    err.status = 400;
    throw err;
  }

  const vanCode = trim(body.vanCode);
  if (!vanCode) {
    const err = new Error('vanCode is required');
    err.status = 400;
    throw err;
  }

  const vanName = trim(body.vanName);
  if (!vanName) {
    const err = new Error('vanName is required');
    err.status = 400;
    throw err;
  }

  const plateNo = trim(body.plateNo) || null;

  const existing = await vanRepo.findVan(pool, companyId, id);
  if (!existing) {
    const err = new Error('Van not found');
    err.status = 404;
    throw err;
  }

  const updated = await vanRepo.updateVan(pool, { companyId, vanId: id, vanCode, vanName, plateNo, actor });
  if (!updated) {
    const err = new Error('Van not found');
    err.status = 404;
    throw err;
  }
  return updated;
}

export async function toggleVan(pool, vanId, authStaff) {
  const { companyId, actor } = authContext(authStaff);
  const id = Number(vanId);
  if (!Number.isFinite(id) || id < 1) {
    const err = new Error('Invalid vanId');
    err.status = 400;
    throw err;
  }

  const existing = await vanRepo.findVan(pool, companyId, id);
  if (!existing) {
    const err = new Error('Van not found');
    err.status = 404;
    throw err;
  }

  const updated = await vanRepo.toggleVanActive(pool, companyId, id, !existing.isActive, actor);
  if (!updated) {
    const err = new Error('Van not found');
    err.status = 404;
    throw err;
  }
  return updated;
}
