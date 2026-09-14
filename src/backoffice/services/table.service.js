import { withTransaction } from '../../config/db.js';
import * as tableRepo from '../repositories/table.repository.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import { actorStaffPk } from '../../utils/actorStaff.js';
import { assertLimitAvailable } from '../../core/services/entitlement.service.js';
import {
  firstNonEmptyByBranch,
  getStationLocation,
  locationBranchCandidates,
} from '../../shared/locationScope.js';

const TABLE_FORMATS = new Set(['SQUARE', 'ROUND', 'RECTANGLE', 'CUSTOM']);

function parsePosInt(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.trunc(n);
}

export async function listTables(pool, authStaff, branchIdQuery, areaIdQuery) {
  const companyId = Number(authStaff.company_id);
  const requested = parsePosInt(branchIdQuery);
  const authStation = parsePosInt(authStaff.station_id);
  const authPhysical = parsePosInt(authStaff.branch_id);

  const scopes = [];
  const add = (id) => {
    if (id != null && !scopes.includes(id)) scopes.push(id);
  };

  const lookupId = requested ?? authStation;
  if (lookupId != null) {
    const location = await getStationLocation(pool, companyId, lookupId);
    if (location) {
      locationBranchCandidates(location).forEach(add);
    }
  }

  const asBranch = requested ?? authPhysical;
  if (asBranch != null) {
    const ok = await branchRepo.branchBelongsToCompany(pool, companyId, asBranch);
    if (ok) add(asBranch);
  }

  if (requested != null && !scopes.includes(requested)) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }

  if (!scopes.length) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }

  const areaId = parsePosInt(areaIdQuery);
  return firstNonEmptyByBranch(scopes, (branchId) =>
    areaId != null
      ? tableRepo.listTablesByArea(pool, companyId, branchId, areaId)
      : tableRepo.listTablesByBranch(pool, companyId, branchId)
  );
}

export async function createTable(pool, body, authStaff) {
  const tableName = (body.tableName ?? '').trim().slice(0, 50);
  if (!tableName) {
    const err = new Error('tableName is required');
    err.status = 400;
    throw err;
  }

  const branchId = parsePosInt(body.branchId);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }

  const areaId = parsePosInt(body.areaId);
  if (areaId == null) {
    const err = new Error('areaId is required');
    err.status = 400;
    throw err;
  }

  const tableNo = parsePosInt(body.tableNo);
  if (tableNo == null) {
    const err = new Error('tableNo must be a positive integer');
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

  let tableFormat = String(body.tableFormat ?? 'SQUARE').trim().toUpperCase();
  if (!TABLE_FORMATS.has(tableFormat)) tableFormat = 'SQUARE';

  const noOfChairs = Math.max(1, Math.min(100, parsePosInt(body.noOfChairs) ?? 4));

  const tableNameArabic =
    body.tableNameArabic != null ? String(body.tableNameArabic).trim().slice(0, 50) || null : null;

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `core.table_master:${companyId}`,
    ]);
    await assertLimitAvailable({
      companyId,
      limitCode: 'active_tables',
      countFn: tableRepo.countActiveTables,
      db: client,
    });
    const tableId = await tableRepo.nextTableId(client, companyId, branchId);
    return tableRepo.insertTable(client, {
      tableId,
      companyId,
      branchId,
      areaId,
      tableNo,
      tableName,
      tableNameArabic,
      noOfChairs,
      tableFormat,
      createdBy: null,
      modifiedBy: null,
    });
  });
}
