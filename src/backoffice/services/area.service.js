import { withTransaction } from '../../config/db.js';
import * as areaRepo from '../repositories/area.repository.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import { actorStaffPk } from '../../utils/actorStaff.js';

const SUPPLY_TYPES = new Set(['DINE_IN', 'DELIVERY', 'PARCEL', 'TAKEAWAY', 'GENERAL']);

function parseBranchId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

export async function listAreas(pool, authStaff, branchIdQuery) {
  const companyId = Number(authStaff.company_id);
  let bid = parseBranchId(branchIdQuery);
  if (bid == null) {
    bid = parseBranchId(authStaff.branch_id);
  }
  if (bid == null) {
    const err = new Error('branchId is required (query branchId or set staff default branch)');
    err.status = 400;
    throw err;
  }
  const ok = await branchRepo.branchBelongsToCompany(pool, companyId, bid);
  if (!ok) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }
  return areaRepo.listAreasByCompanyAndBranch(pool, companyId, bid);
}

export async function createArea(pool, body, authStaff) {
  const nameRaw = (body.areaName ?? '').trim();
  if (!nameRaw) {
    const err = new Error('areaName is required');
    err.status = 400;
    throw err;
  }
  const areaName = nameRaw.slice(0, 150);

  const branchId = parseBranchId(body.branchId);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }

  const companyId = Number(authStaff.company_id);
  const branchOk = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!branchOk) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }

  let supplyType = String(body.supplyType ?? 'GENERAL').trim().toUpperCase() || 'GENERAL';
  if (!SUPPLY_TYPES.has(supplyType)) {
    const err = new Error(`supplyType must be one of: ${[...SUPPLY_TYPES].join(', ')}`);
    err.status = 400;
    throw err;
  }

  const arRaw = body.areaNameArabic != null ? String(body.areaNameArabic).trim() : '';
  const areaNameArabic = arRaw ? arRaw.slice(0, 50) : null;

  let tableCreationType = Number(body.tableCreationType ?? 0);
  if (!Number.isFinite(tableCreationType)) tableCreationType = 0;
  tableCreationType = Math.max(0, Math.min(32767, Math.trunc(tableCreationType)));

  const kotRaw = body.kotPrefix != null ? String(body.kotPrefix).trim() : '';
  const kotPrefix = kotRaw ? kotRaw.slice(0, 50) : null;

  let isTabletShow = true;
  if (body.isTabletShow === false || body.isTabletShow === 'false') {
    isTabletShow = false;
  }

  const userLabel = (authStaff.staff_name || '').slice(0, 50) || 'system';

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `core.area_master:${companyId}:${branchId}`,
    ]);
    const areaId = await areaRepo.nextAreaId(client, companyId, branchId);
    return areaRepo.insertArea(client, {
      areaId,
      companyId,
      branchId,
      areaName,
      areaNameArabic,
      tableCreationType,
      supplyType,
      kotPrefix,
      isTabletShow,
      createdBy: userLabel,
      modifiedBy: userLabel,
      createdByStaffId: actorStaffPk(authStaff),
    });
  });
}

export async function updateArea(pool, areaIdRaw, body, authStaff) {
  const areaId = Number(areaIdRaw);
  if (!Number.isFinite(areaId) || areaId < 1) {
    const err = new Error('Invalid areaId'); err.status = 400; throw err;
  }
  const nameRaw = (body.areaName ?? '').trim();
  if (!nameRaw) {
    const err = new Error('areaName is required'); err.status = 400; throw err;
  }
  const branchId = Number(body.branchId);
  if (!Number.isFinite(branchId) || branchId < 1) {
    const err = new Error('branchId is required'); err.status = 400; throw err;
  }
  const companyId = Number(authStaff.company_id);
  const branchOk = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!branchOk) {
    const err = new Error('Invalid branch for this company'); err.status = 400; throw err;
  }
  let supplyType = String(body.supplyType ?? 'GENERAL').trim().toUpperCase() || 'GENERAL';
  if (!SUPPLY_TYPES.has(supplyType)) supplyType = 'GENERAL';
  const arRaw = body.areaNameArabic != null ? String(body.areaNameArabic).trim() : '';
  const areaNameArabic = arRaw ? arRaw.slice(0, 50) : null;
  const kotRaw = body.kotPrefix != null ? String(body.kotPrefix).trim() : '';
  const kotPrefix = kotRaw ? kotRaw.slice(0, 50) : null;
  let isTabletShow = true;
  if (body.isTabletShow === false || body.isTabletShow === 'false') isTabletShow = false;
  const modifiedBy = (authStaff.staff_name || '').slice(0, 50) || 'system';
  const row = await areaRepo.updateArea(pool, {
    companyId, branchId, areaId,
    areaName: nameRaw.slice(0, 150),
    areaNameArabic, supplyType, kotPrefix, isTabletShow, modifiedBy,
  });
  if (!row) {
    const err = new Error('Area not found'); err.status = 404; throw err;
  }
  return row;
}

export async function deleteArea(pool, areaIdRaw, branchIdRaw, authStaff) {
  const areaId = Number(areaIdRaw);
  const branchId = Number(branchIdRaw);
  if (!Number.isFinite(areaId) || areaId < 1) {
    const err = new Error('Invalid areaId'); err.status = 400; throw err;
  }
  if (!Number.isFinite(branchId) || branchId < 1) {
    const err = new Error('branchId is required'); err.status = 400; throw err;
  }
  const companyId = Number(authStaff.company_id);
  const deleted = await areaRepo.deleteArea(pool, companyId, branchId, areaId);
  if (!deleted) {
    const err = new Error('Area not found'); err.status = 404; throw err;
  }
  return { ok: true };
}
