import { withTransaction } from '../config/db.js';
import * as supplierRepo from '../repositories/supplier.repository.js';
import { assertLimitAvailable } from './entitlement.service.js';

function trimOrEmpty(v) {
  if (v == null) return '';
  return String(v).trim();
}

function sliceOrNull(v, maxLen) {
  const s = trimOrEmpty(v);
  if (!s) return null;
  return s.slice(0, maxLen);
}

export async function updateSupplier(pool, supplierId, body, authStaff) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid company on session'); err.status = 400; throw err;
  }
  const id = Number(supplierId);
  if (!Number.isFinite(id) || id < 1) {
    const err = new Error('Invalid supplierId'); err.status = 400; throw err;
  }
  const code = trimOrEmpty(body.supplierCode);
  if (!code) { const err = new Error('supplierCode is required'); err.status = 400; throw err; }
  if (code.length > 25) { const err = new Error('supplierCode must be at most 25 characters'); err.status = 400; throw err; }
  const name = trimOrEmpty(body.supplierName);
  if (!name) { const err = new Error('supplierName is required'); err.status = 400; throw err; }
  const userLabel = (authStaff.staff_name || '').slice(0, 50) || 'system';
  const updated = await supplierRepo.updateSupplier(pool, companyId, id, {
    supplierCode: code,
    supplierName: name.slice(0, 200),
    mobileNo: sliceOrNull(body.mobileNo, 25),
    email: sliceOrNull(body.email, 75),
    modifiedBy: userLabel,
  });
  if (!updated) {
    const err = new Error('Supplier not found'); err.status = 404; throw err;
  }
  return updated;
}

export async function listSuppliers(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid company on session');
    err.status = 400;
    throw err;
  }
  const limit = query?.limit != null ? Number(query.limit) : 500;
  return supplierRepo.listSuppliers(pool, companyId, limit);
}

export async function createSupplier(pool, body, authStaff) {
  const code = trimOrEmpty(body.supplierCode);
  if (!code) {
    const err = new Error('supplierCode is required');
    err.status = 400;
    throw err;
  }
  if (code.length > 25) {
    const err = new Error('supplierCode must be at most 25 characters');
    err.status = 400;
    throw err;
  }

  const name = trimOrEmpty(body.supplierName);
  if (!name) {
    const err = new Error('supplierName is required');
    err.status = 400;
    throw err;
  }
  if (name.length > 200) {
    const err = new Error('supplierName must be at most 200 characters');
    err.status = 400;
    throw err;
  }

  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid company on session');
    err.status = 400;
    throw err;
  }

  const userLabel = (authStaff.staff_name || '').slice(0, 50) || 'system';

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `biz.supplier_master:${companyId}`,
    ]);
    await assertLimitAvailable({
      companyId,
      limitCode: 'suppliers',
      countFn: supplierRepo.countActiveSuppliers,
      db: client,
    });
    const supplierId = await supplierRepo.nextSupplierId(client, companyId);
    await supplierRepo.insertSupplier(client, {
      companyId,
      supplierId,
      supplierCode: code,
      supplierName: name.slice(0, 200),
      mobileNo: sliceOrNull(body.mobileNo, 25),
      email: sliceOrNull(body.email, 75),
      recordStatus: 'ACTIVE',
      createdBy: userLabel,
      modifiedBy: userLabel,
    });
    return {
      supplierId,
      supplierCode: code,
      supplierName: name.slice(0, 200),
    };
  });
}
