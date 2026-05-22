import { withTransaction } from '../config/db.js';
import * as tableRepo from '../repositories/table.repository.js';
import * as branchRepo from '../repositories/branch.repository.js';
import { actorStaffPk } from '../utils/actorStaff.js';
import { assertLimitAvailable } from './entitlement.service.js';

const TABLE_FORMATS = new Set(['SQUARE', 'ROUND', 'RECTANGLE', 'CUSTOM']);

function parsePosInt(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.trunc(n);
}

export async function listTables(pool, authStaff, branchIdQuery, areaIdQuery) {
  const companyId = Number(authStaff.company_id);

  let branchId = parsePosInt(branchIdQuery);
  if (branchId == null) branchId = parsePosInt(authStaff.branch_id);
  if (branchId == null) {
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

  const areaId = parsePosInt(areaIdQuery);
  if (areaId != null) {
    return tableRepo.listTablesByArea(pool, companyId, branchId, areaId);
  }
  return tableRepo.listTablesByBranch(pool, companyId, branchId);
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

  const userLabel = (authStaff.staff_name || '').slice(0, 50) || 'system';

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
      createdBy: userLabel,
      modifiedBy: userLabel,
    });
  });
}
