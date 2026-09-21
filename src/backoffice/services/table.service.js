import { withTransaction } from '../../config/db.js';
import * as tableRepo from '../repositories/table.repository.js';
import * as areaRepo from '../repositories/area.repository.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import { actorStaffPk } from '../../utils/actorStaff.js';
import { assertLimitAvailable } from '../../core/services/entitlement.service.js';
import {
  firstNonEmptyByBranch,
  getStationLocation,
  locationBranchCandidates,
  resolveMasterBranchId,
} from '../../shared/locationScope.js';

const TABLE_FORMATS = new Set(['SQUARE', 'ROUND', 'OVAL', 'RECTANGLE', 'CUSTOM']);

function parsePosInt(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.trunc(n);
}

function bad(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function masterBranchId(pool, authStaff, requested) {
  const companyId = Number(authStaff.company_id);
  if (requested != null) {
    const ok = await branchRepo.branchBelongsToCompany(pool, companyId, requested);
    if (ok) return requested;
  }
  const resolved = await resolveMasterBranchId(pool, companyId, authStaff);
  if (resolved != null) return resolved;
  throw bad('branchId is required');
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
  const tableName = String(body.tableName ?? '').toUpperCase().trim().slice(0, 50);
  if (!tableName) {
    throw bad('Please Enter Table Name ....');
  }

  const tableNo = parsePosInt(body.tableNo);
  if (tableNo == null) {
    throw bad('Please Enter Table No.   ....');
  }

  const chairsRaw = body.noOfChairs ?? body.NoofChairs ?? body.noofchairs;
  const noOfChairs = parsePosInt(chairsRaw);
  if (noOfChairs == null) {
    throw bad('Please Enter No. of Chairs  ....');
  }

  const areaId = parsePosInt(body.areaId ?? body.AreaID);
  if (areaId == null) {
    throw bad('areaId is required');
  }

  const companyId = Number(authStaff.company_id);
  const branchId = await masterBranchId(pool, authStaff, parsePosInt(body.branchId));

  const area = await areaRepo.findArea(pool, companyId, branchId, areaId);
  if (!area) throw bad('Invalid Area...');
  if (Number(area.tableCreationType) !== 0) {
    throw bad('Select a Manual table area.');
  }

  const exists = await tableRepo.findTableByName(pool, companyId, branchId, tableName);
  if (exists) {
    throw bad('Table Name. already existing...');
  }

  let tableFormat = String(body.tableFormat ?? 'SQUARE').trim().toUpperCase();
  if (!TABLE_FORMATS.has(tableFormat)) tableFormat = 'SQUARE';

  const tableNameArabic =
    body.tableNameArabic != null ? String(body.tableNameArabic).trim().slice(0, 50) || null : null;
  const assignedWaiterId = parsePosInt(body.assignedWaiterId ?? body.waiterId ?? body.WaiterID);

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
    const dup = await tableRepo.findTableByName(client, companyId, branchId, tableName);
    if (dup) throw bad('Table Name. already existing...');
    const tableId = await tableRepo.nextTableId(client, companyId, branchId);
    try {
      return await tableRepo.insertTable(client, {
        tableId,
        companyId,
        branchId,
        areaId,
        tableNo,
        tableName,
        tableNameArabic,
        noOfChairs: Math.max(1, Math.min(100, noOfChairs)),
        tableFormat,
        assignedWaiterId,
        createdBy: null,
        modifiedBy: null,
      });
    } catch (err) {
      if (err.code === '23514' && tableFormat === 'OVAL') {
        return tableRepo.insertTable(client, {
          tableId,
          companyId,
          branchId,
          areaId,
          tableNo,
          tableName,
          tableNameArabic,
          noOfChairs: Math.max(1, Math.min(100, noOfChairs)),
          tableFormat: 'CUSTOM',
          assignedWaiterId,
          createdBy: null,
          modifiedBy: null,
        });
      }
      throw err;
    }
  });
}

export async function updateTable(pool, tableIdRaw, body, authStaff) {
  const tableId = parsePosInt(tableIdRaw);
  if (tableId == null) throw bad('Invalid Table...');
  const tableName = String(body.tableName ?? '').toUpperCase().trim().slice(0, 50);
  if (!tableName) throw bad('Please Enter Table Name ....');
  const tableNo = parsePosInt(body.tableNo);
  if (tableNo == null) throw bad('Please Enter Table No.   ....');
  const noOfChairs = parsePosInt(body.noOfChairs ?? body.NoofChairs);
  if (noOfChairs == null) throw bad('Please Enter No. of Chairs  ....');
  const areaId = parsePosInt(body.areaId ?? body.AreaID);
  if (areaId == null) throw bad('areaId is required');

  const companyId = Number(authStaff.company_id);
  const branchId = await masterBranchId(pool, authStaff, parsePosInt(body.branchId));
  const area = await areaRepo.findArea(pool, companyId, branchId, areaId);
  if (!area) throw bad('Invalid Area...');

  const exists = await tableRepo.findTableByName(pool, companyId, branchId, tableName, tableId);
  if (exists) throw bad('Table Name. already existing...');

  let tableFormat = String(body.tableFormat ?? 'SQUARE').trim().toUpperCase();
  if (!TABLE_FORMATS.has(tableFormat)) tableFormat = 'SQUARE';
  const tableNameArabic =
    body.tableNameArabic != null ? String(body.tableNameArabic).trim().slice(0, 50) || null : null;
  const assignedWaiterId = parsePosInt(body.assignedWaiterId ?? body.waiterId ?? body.WaiterID);

  const row = await tableRepo.updateTable(pool, {
    companyId,
    branchId,
    tableId,
    areaId,
    tableNo,
    tableName,
    tableNameArabic,
    noOfChairs: Math.max(1, Math.min(100, noOfChairs)),
    tableFormat: tableFormat === 'OVAL' ? tableFormat : tableFormat,
    assignedWaiterId,
    modifiedBy: actorStaffPk(authStaff),
  });
  if (!row) throw bad('Table not Found...', 404);
  return row;
}

export async function nextTableNumber(pool, authStaff, branchIdQuery) {
  const companyId = Number(authStaff.company_id);
  const branchId = await masterBranchId(pool, authStaff, parsePosInt(branchIdQuery));
  const n = await tableRepo.nextTableNo(pool, companyId, branchId);
  return { tableNo: n, branchId };
}

export async function listWaiters(pool, authStaff) {
  const companyId = Number(authStaff.company_id);
  const branchId = await resolveMasterBranchId(pool, companyId, authStaff);
  return tableRepo.listWaiters(pool, companyId, branchId);
}
