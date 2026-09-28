import { withTransaction } from '../../config/db.js';
import * as areaRepo from '../repositories/area.repository.js';
import { actorStaffPk } from '../../utils/actorStaff.js';
import {
  getStationLocation,
  locationBranchCandidates,
  mergeByBranch,
  resolveMasterBranchId,
} from '../../shared/locationScope.js';

const SUPPLY_TYPES = new Set(['DINE_IN', 'DELIVERY', 'PARCEL', 'TAKEAWAY', 'GENERAL']);
const PRICE_LEVELS = new Set([
  'NORMAL',
  'PRICE LEVEL 1',
  'PRICE LEVEL 2',
  'PRICE LEVEL 3',
  'PRICE LEVEL 4',
  'PRICE LEVEL 5',
]);

function parseStationId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

function bad(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeSupplyType(raw) {
  const u = String(raw ?? '')
    .replace(/_/g, ' ')
    .toUpperCase()
    .trim();
  if (u === 'DINE IN' || u === 'DINEIN') return 'DINE_IN';
  if (u === 'PARCEL' || u === 'TAKEAWAY' || u === 'TAKE AWAY') return 'PARCEL';
  if (u === 'DELIVERY') return 'DELIVERY';
  if (u === 'GENERAL') return 'GENERAL';
  return '';
}

function normalizePriceLevel(raw) {
  const u = String(raw ?? '').trim().toUpperCase();
  if (!u) return '';
  if (u === 'NORMAL') return 'Normal';
  const m = u.match(/^PRICE LEVEL ([1-5])$/);
  if (m) return `Price Level ${m[1]}`;
  return '';
}

async function assertStationBelongsToCompany(pool, companyId, stationId) {
  const { rowCount } = await pool.query(
    `SELECT 1
     FROM core.station_master
     WHERE company_id = $1
       AND station_id = $2
       AND is_deleted = FALSE
     LIMIT 1`,
    [companyId, stationId]
  );
  if (!rowCount) {
    const err = new Error('Invalid station for this company');
    err.status = 400;
    throw err;
  }
}

function resolveStationId(explicitId, authStaff) {
  return parseStationId(explicitId) ?? parseStationId(authStaff.station_id);
}

export async function listAreas(pool, authStaff, branchIdQuery) {
  const companyId = Number(authStaff.company_id);
  const stationId = resolveStationId(branchIdQuery, authStaff);
  if (stationId == null) {
    const err = new Error('stationId is required');
    err.status = 400;
    throw err;
  }
  await assertStationBelongsToCompany(pool, companyId, stationId);
  const location = await getStationLocation(pool, companyId, stationId);
  return mergeByBranch(
    locationBranchCandidates(location ?? { stationId }),
    (branchId) => areaRepo.listAreasByCompanyAndBranch(pool, companyId, branchId),
    (row, branchId) => `${row.branchId ?? branchId}:${row.areaId}`
  );
}

export async function createArea(pool, body, authStaff) {
  const nameRaw = (body.areaName ?? '').trim();
  const arabicRaw = body.areaNameArabic != null ? String(body.areaNameArabic).trim() : '';
  if (!nameRaw && !arabicRaw) {
    throw bad('Enter Area name...');
  }

  const supplyType = normalizeSupplyType(body.supplyType);
  if (!supplyType || !SUPPLY_TYPES.has(supplyType)) {
    throw bad('Select a Supply Type...');
  }

  const kotRaw = body.kotPrefix != null ? String(body.kotPrefix).trim() : '';
  if (!kotRaw) {
    throw bad('Enter Prefix...');
  }

  const priceLevel = normalizePriceLevel(body.priceLevel);
  if (!priceLevel || !PRICE_LEVELS.has(priceLevel.toUpperCase())) {
    throw bad('Select Price Level...');
  }

  const companyId = Number(authStaff.company_id);
  const stationId = resolveStationId(body.stationId ?? body.branchId, authStaff);
  if (stationId != null) {
    await assertStationBelongsToCompany(pool, companyId, stationId);
  }
  const branchId = await resolveMasterBranchId(pool, companyId, authStaff);
  if (branchId == null) {
    throw bad('stationId is required');
  }

  const areaName = (nameRaw || ' ').toUpperCase().slice(0, 150);
  const areaNameArabic = arabicRaw ? arabicRaw.slice(0, 50) : ' ';

  let tableCreationType = Number(body.tableCreationType ?? 0);
  if (!Number.isFinite(tableCreationType)) tableCreationType = 0;
  tableCreationType = body.tableCreationType === 1 || body.tableCreationType === '1' || body.rbtnAuto === true
    ? 1
    : Math.max(0, Math.min(1, Math.trunc(tableCreationType)));

  let isTabletShow = true;
  if (body.isTabletShow === false || body.isTabletShow === 'false' || body.isTabletShow === 0 || body.isTabletShow === '0') {
    isTabletShow = false;
  }

  const exists = await areaRepo.findAreaByName(pool, companyId, branchId, areaName);
  if (exists) {
    throw bad('AreaName already  exist......');
  }

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `core.area_master:${companyId}:${branchId}`,
    ]);
    const dup = await areaRepo.findAreaByName(client, companyId, branchId, areaName);
    if (dup) throw bad('AreaName already  exist......');
    const areaId = await areaRepo.nextAreaId(client, companyId, branchId);
    return areaRepo.insertArea(client, {
      areaId,
      companyId,
      branchId,
      areaName,
      areaNameArabic,
      tableCreationType,
      supplyType,
      kotPrefix: kotRaw.slice(0, 50),
      priceLevel,
      isTabletShow,
      createdBy: null,
      modifiedBy: null,
      createdByStaffId: actorStaffPk(authStaff),
    });
  });
}

export async function updateArea(pool, areaIdRaw, body, authStaff) {
  const areaId = Number(areaIdRaw);
  if (!Number.isFinite(areaId) || areaId < 1) {
    throw bad('Invalid Area...');
  }
  const nameRaw = (body.areaName ?? '').trim();
  const arabicRaw = body.areaNameArabic != null ? String(body.areaNameArabic).trim() : '';
  if (!nameRaw && !arabicRaw) {
    throw bad('Enter Area name...');
  }
  const supplyType = normalizeSupplyType(body.supplyType);
  if (!supplyType) throw bad('Select a Supply Type...');
  const kotRaw = body.kotPrefix != null ? String(body.kotPrefix).trim() : '';
  if (!kotRaw) throw bad('Enter Prefix...');
  const priceLevel = normalizePriceLevel(body.priceLevel);
  if (!priceLevel) throw bad('Select Price Level...');

  const companyId = Number(authStaff.company_id);
  const branchId = await resolveMasterBranchId(pool, companyId, authStaff);
  if (branchId == null) throw bad('stationId is required');

  const areaName = (nameRaw || ' ').toUpperCase().slice(0, 150);
  const exists = await areaRepo.findAreaByName(pool, companyId, branchId, areaName, areaId);
  if (exists) throw bad('AreaName already  exist......');

  let tableCreationType = Number(body.tableCreationType ?? 0);
  if (!Number.isFinite(tableCreationType)) tableCreationType = 0;
  tableCreationType = Math.max(0, Math.min(1, Math.trunc(tableCreationType)));
  let isTabletShow = true;
  if (body.isTabletShow === false || body.isTabletShow === 'false' || body.isTabletShow === 0 || body.isTabletShow === '0') {
    isTabletShow = false;
  }
  const row = await areaRepo.updateArea(pool, {
    companyId,
    branchId,
    areaId,
    areaName,
    areaNameArabic: arabicRaw ? arabicRaw.slice(0, 50) : ' ',
    tableCreationType,
    supplyType,
    kotPrefix: kotRaw.slice(0, 50),
    priceLevel,
    isTabletShow,
    modifiedBy: null,
  });
  if (!row) throw bad('Area not Found...', 404);
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
