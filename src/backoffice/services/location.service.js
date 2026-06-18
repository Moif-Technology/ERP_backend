import { withTransaction } from '../../config/db.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as locationRepo from '../repositories/location.repository.js';

function trim(v) { return String(v ?? '').trim(); }

export async function listLocations(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const branchId = Number(query?.branchId ?? authStaff.branch_id);
  if (!Number.isFinite(branchId) || branchId < 1) {
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
  return locationRepo.listLocationsByBranch(pool, companyId, branchId);
}

export async function createLocation(pool, body, authStaff) {
  const companyId = Number(authStaff.company_id);
  const branchId = Number(body.branchId ?? authStaff.branch_id);
  if (!Number.isFinite(branchId) || branchId < 1) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const locationCode = trim(body.locationCode).toUpperCase().slice(0, 50);
  if (!locationCode) {
    const err = new Error('locationCode is required');
    err.status = 400;
    throw err;
  }
  const locationName = trim(body.locationName).slice(0, 100);
  if (!locationName) {
    const err = new Error('locationName is required');
    err.status = 400;
    throw err;
  }
  const ok = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!ok) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }
  return withTransaction(async (client) => {
    const locationId = await locationRepo.nextLocationId(client, companyId);
    return locationRepo.insertLocation(client, {
      companyId, branchId, locationId, locationCode, locationName,
      createdBy: (authStaff.staff_name || '').slice(0, 50) || 'system',
    });
  });
}

export async function updateLocation(pool, locationId, body, authStaff) {
  const companyId = Number(authStaff.company_id);
  const lid = Number(locationId);
  if (!Number.isFinite(lid) || lid < 1) {
    const err = new Error('Invalid locationId');
    err.status = 400;
    throw err;
  }
  const locationCode = trim(body.locationCode).toUpperCase().slice(0, 50);
  if (!locationCode) {
    const err = new Error('locationCode is required');
    err.status = 400;
    throw err;
  }
  const locationName = trim(body.locationName).slice(0, 100);
  if (!locationName) {
    const err = new Error('locationName is required');
    err.status = 400;
    throw err;
  }
  return withTransaction(async (client) => {
    const row = await locationRepo.updateLocation(client, { companyId, locationId: lid, locationCode, locationName });
    if (!row) {
      const err = new Error('Location not found');
      err.status = 404;
      throw err;
    }
    return row;
  });
}

export async function deleteLocation(pool, locationId, authStaff) {
  const companyId = Number(authStaff.company_id);
  const lid = Number(locationId);
  if (!Number.isFinite(lid) || lid < 1) {
    const err = new Error('Invalid locationId');
    err.status = 400;
    throw err;
  }
  return withTransaction(async (client) => {
    const deleted = await locationRepo.softDeleteLocation(client, companyId, lid);
    if (!deleted) {
      const err = new Error('Location not found');
      err.status = 404;
      throw err;
    }
    return { deleted: true };
  });
}
