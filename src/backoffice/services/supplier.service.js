import { withTransaction } from '../../config/db.js';
import * as supplierRepo from '../repositories/supplier.repository.js';
import { assertLimitAvailable } from '../../core/services/entitlement.service.js';
import * as partyLedger from './partyLedger.service.js';
import { nextDocNo } from '../../shared/services/docSequence.service.js';

function trimOrEmpty(v) {
  if (v == null) return '';
  return String(v).trim();
}

function sliceOrNull(v, maxLen) {
  const s = trimOrEmpty(v);
  if (!s) return null;
  return s.slice(0, maxLen);
}

function numericOrZero(v, defaultVal = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : defaultVal;
}

function intOrZero(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function getSupplierById(pool, supplierId, authStaff) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid company on session'); err.status = 400; throw err;
  }
  const id = Number(supplierId);
  if (!Number.isFinite(id) || id < 1) {
    const err = new Error('Invalid supplierId'); err.status = 400; throw err;
  }
  const supplier = await supplierRepo.getSupplierById(pool, companyId, id);
  if (!supplier) {
    const err = new Error('Supplier not found'); err.status = 404; throw err;
  }
  return supplier;
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
  const userId = authStaff.id != null ? Number(authStaff.id) : null;
  const branchId = authStaff.branch_id != null ? Number(authStaff.branch_id) : null;
  const parentAccId = body.parentAccId ?? body.supplierParentAccId ?? null;

  return withTransaction(async (client) => {
    const existing = await supplierRepo.findSupplierById(client, companyId, id);
    if (!existing) {
      const err = new Error('Supplier not found'); err.status = 404; throw err;
    }

    const updated = await supplierRepo.updateSupplier(client, companyId, id, {
      supplierCode:     code,
      supplierName:     name.slice(0, 200),
      mobileNo:         sliceOrNull(body.mobileNo, 25),
      email:            sliceOrNull(body.email, 75),
      taxRegNo:         sliceOrNull(body.taxRegNo, 100),
      contactPerson:    sliceOrNull(body.contactPerson, 200),
      address:          sliceOrNull(body.address, 300),
      poBox:            sliceOrNull(body.poBox, 15),
      city:             sliceOrNull(body.city, 50),
      country:          sliceOrNull(body.country, 50),
      telephone:        sliceOrNull(body.telephone, 25),
      faxNo:            sliceOrNull(body.faxNo, 15),
      paymentMode:      sliceOrNull(body.paymentMode, 50),
      creditLimit:      numericOrZero(body.creditLimit),
      creditBalance:    numericOrZero(body.creditBalance),
      creditPeriodDays: intOrZero(body.creditPeriodDays),
      remark:           sliceOrNull(body.remark, 750),
      modifiedBy:       userId,
    });
    if (!updated) {
      const err = new Error('Supplier not found'); err.status = 404; throw err;
    }

    let ledger = null;
    try {
      await client.query('SAVEPOINT supplier_ledger');
      ledger = await partyLedger.syncSupplierLedger(client, {
        companyId,
        branchId,
        supplierCode: code,
        supplierName: name.slice(0, 200),
        previousCode: existing.supplierCode,
        parentAccId,
      });
      await client.query('RELEASE SAVEPOINT supplier_ledger');
    } catch (ledgerErr) {
      await client.query('ROLLBACK TO SAVEPOINT supplier_ledger').catch(() => {});
      if (ledgerErr.code === '42P01' || ledgerErr.code === '42703') {
        console.warn('[supplier] Account head tables missing — ledger not updated');
      } else {
        throw ledgerErr;
      }
    }

    return {
      ...updated,
      ledgerAccountId:  ledger?.accountId ?? null,
      ledgerParentAccId: ledger?.parentAccId ?? null,
    };
  });
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

/** Create or refresh supplier sub-ledger in chart of accounts. */
export async function postSupplierLedger(pool, supplierId, authStaff, body = {}) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid company on session');
    err.status = 400;
    throw err;
  }
  const id = Number(supplierId);
  if (!Number.isFinite(id) || id < 1) {
    const err = new Error('Invalid supplierId');
    err.status = 400;
    throw err;
  }

  return withTransaction(async (client) => {
    const supplier = await supplierRepo.findSupplierById(client, companyId, id);
    if (!supplier) {
      const err = new Error('Supplier not found');
      err.status = 404;
      throw err;
    }

    const branchId = authStaff.branch_id != null ? Number(authStaff.branch_id) : null;
    const parentAccId = body.parentAccId ?? body.supplierParentAccId ?? null;

    const ledger = await partyLedger.syncSupplierLedger(client, {
      companyId,
      branchId,
      supplierCode: supplier.supplierCode,
      supplierName: supplier.supplierName,
      parentAccId,
    });

    return {
      supplierId: id,
      supplierCode: supplier.supplierCode,
      ledgerAccountId: ledger.accountId,
      ledgerParentAccId: ledger.parentAccId,
      created: ledger.created,
      message: ledger.created
        ? 'Supplier ledger created in chart of accounts'
        : 'Supplier ledger already exists — updated',
    };
  });
}

export async function createSupplier(pool, body, authStaff) {
  let code = trimOrEmpty(body.supplierCode);
  const wantsAutoCode = Boolean(body.autoCode);
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

  const userId = authStaff.id != null ? Number(authStaff.id) : null;
  const branchId = authStaff.branch_id != null ? Number(authStaff.branch_id) : null;

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
    if (!code && wantsAutoCode) {
      code = await nextDocNo(client, { companyId, branchId: branchId ?? 0, sequenceCode: 'SUPPLIER' });
    }
    if (!code) {
      const err = new Error('supplierCode is required');
      err.status = 400;
      throw err;
    }
    const supplierId = await supplierRepo.nextSupplierId(client, companyId);
    const parentAccId = body.parentAccId ?? body.supplierParentAccId ?? null;

    await supplierRepo.insertSupplier(client, {
      companyId,
      supplierId,
      supplierCode:     code,
      supplierName:     name.slice(0, 200),
      mobileNo:         sliceOrNull(body.mobileNo, 25),
      email:            sliceOrNull(body.email, 75),
      taxRegNo:         sliceOrNull(body.taxRegNo, 100),
      contactPerson:    sliceOrNull(body.contactPerson, 200),
      address:          sliceOrNull(body.address, 300),
      poBox:            sliceOrNull(body.poBox, 15),
      city:             sliceOrNull(body.city, 50),
      country:          sliceOrNull(body.country, 50),
      telephone:        sliceOrNull(body.telephone, 25),
      faxNo:            sliceOrNull(body.faxNo, 15),
      paymentMode:      sliceOrNull(body.paymentMode, 50),
      creditLimit:      numericOrZero(body.creditLimit),
      creditBalance:    numericOrZero(body.creditBalance),
      creditPeriodDays: intOrZero(body.creditPeriodDays),
      remark:           sliceOrNull(body.remark, 750),
      recordStatus:     'ACTIVE',
      createdBy:        userId,
      modifiedBy:       userId,
    });

    let ledger = null;
    try {
      await client.query('SAVEPOINT supplier_ledger');
      ledger = await partyLedger.syncSupplierLedger(client, {
        companyId,
        branchId,
        supplierCode: code,
        supplierName: name.slice(0, 200),
        parentAccId,
      });
      await client.query('RELEASE SAVEPOINT supplier_ledger');
    } catch (ledgerErr) {
      await client.query('ROLLBACK TO SAVEPOINT supplier_ledger').catch(() => {});
      if (ledgerErr.code === '42P01' || ledgerErr.code === '42703') {
        console.warn('[supplier] Account head tables missing — ledger not created');
      } else {
        throw ledgerErr;
      }
    }

    return {
      supplierId,
      supplierCode: code,
      supplierName: name.slice(0, 200),
      ledgerAccountId:   ledger?.accountId ?? null,
      ledgerParentAccId: ledger?.parentAccId ?? null,
    };
  });
}
