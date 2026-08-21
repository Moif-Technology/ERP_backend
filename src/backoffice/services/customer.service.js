import { withTransaction } from '../../config/db.js';
import * as customerRepo from '../repositories/customer.repository.js';
import { actorStaffPk, auditUserName } from '../../utils/actorStaff.js';
import { generateScopedAutoCode } from '../../utils/autoCode.js';
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

function parseMoney(v, fallback = 0) {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n * 100) / 100;
}

function parseIntNonNeg(v, fallback = 0) {
  if (v == null || v === '') return fallback;
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function parseManagedBy(body, authStaff) {
  if (body.managedByStaffId != null && body.managedByStaffId !== '') {
    const n = Number(body.managedByStaffId);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  return actorStaffPk(authStaff);
}

/** UI: Yes / No → DB loyalty_status */
function loyaltyFromForm(raw) {
  const s = trimOrEmpty(raw).toUpperCase();
  if (s === 'YES' || s === 'Y' || s === 'ACTIVE') return 'ACTIVE';
  return 'INACTIVE';
}

function creditStatusFromForm(raw) {
  const s = trimOrEmpty(raw).toUpperCase() || 'ACTIVE';
  if (s === 'ACTIVE' || s === 'INACTIVE' || s === 'HOLD') return s;
  return 'ACTIVE';
}

/**
 * Allocates customer_id per company; company from JWT staff row.
 */
export async function createCustomer(pool, body, authStaff) {
  let code = trimOrEmpty(body.customerCode);
  const wantsAutoCode = Boolean(body.newBarcode || body.autoCode);
  if (code.length > 20) {
    const err = new Error('customerCode must be at most 20 characters');
    err.status = 400;
    throw err;
  }

  const name = trimOrEmpty(body.customerName);
  if (!name) {
    const err = new Error('customerName is required');
    err.status = 400;
    throw err;
  }
  if (name.length > 200) {
    const err = new Error('customerName must be at most 200 characters');
    err.status = 400;
    throw err;
  }

  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid company on session');
    err.status = 400;
    throw err;
  }

  const userLabel = auditUserName(authStaff);

  const customerPrefix = sliceOrNull(body.customerPrefix, 1);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `biz.customer_master:${companyId}`,
    ]);
    const branchId = authStaff.branch_id != null ? Number(authStaff.branch_id) : null;
    await assertLimitAvailable({
      companyId,
      limitCode: 'customers',
      countFn: customerRepo.countActiveCustomers,
      db: client,
    });
    if (!code && wantsAutoCode) {
      code = await nextDocNo(client, { companyId, branchId: branchId ?? 0, sequenceCode: 'CUSTOMER' });
    }
    if (!code) {
      const err = new Error('customerCode is required');
      err.status = 400;
      throw err;
    }
    const customerId = await customerRepo.nextCustomerId(client, companyId);
    const parentAccId = body.parentAccId ?? body.customerParentAccId ?? null;

    const created = await customerRepo.insertCustomer(client, {
      companyId,
      customerId,
      customerCode: code,
      customerName: name.slice(0, 200),
      companyName: sliceOrNull(body.companyName, 200),
      customerTaxRegNo: sliceOrNull(body.taxRegNo ?? body.customerTaxRegNo, 100),
      contactPerson: sliceOrNull(body.contactPerson, 200),
      designation: sliceOrNull(body.designation, 200),
      address: sliceOrNull(body.address, 300),
      addressArabic: sliceOrNull(body.addressArabic, 300),
      poBox: sliceOrNull(body.poBox, 15),
      countryName: sliceOrNull(body.country, 100),
      cityName: sliceOrNull(body.city, 100),
      telephone: sliceOrNull(body.telephone, 15),
      fax: sliceOrNull(body.faxNo ?? body.fax, 15),
      email: sliceOrNull(body.email, 75),
      mobileNo: sliceOrNull(body.mobileNo, 25),
      paymentMode: sliceOrNull(body.paymentMode, 50),
      creditBalance: parseMoney(body.creditBalance, 0),
      creditLimit: parseMoney(body.creditLimit, 0),
      creditPeriod: parseIntNonNeg(body.creditPeriodDays ?? body.creditPeriod, 0),
      customerType: sliceOrNull(body.customerType, 50),
      managedBy: parseManagedBy(body, authStaff),
      loyaltyStatus: loyaltyFromForm(body.loyaltyCustStatus ?? body.loyaltyStatus),
      creditStatus: creditStatusFromForm(body.creditStatus),
      remarks: sliceOrNull(body.remarks, 750),
      customerPrefix,
      createdBy: userLabel,
      modifiedBy: userLabel,
      createdByStaffId: actorStaffPk(authStaff),
    });

    let ledger = null;
    try {
      await client.query('SAVEPOINT customer_ledger');
      ledger = await partyLedger.syncCustomerLedger(client, {
        companyId,
        branchId,
        customerCode: code,
        customerName: name.slice(0, 200),
        parentAccId,
      });
      await client.query('RELEASE SAVEPOINT customer_ledger');
    } catch (ledgerErr) {
      await client.query('ROLLBACK TO SAVEPOINT customer_ledger').catch(() => {});
      if (ledgerErr.code === '42P01' || ledgerErr.code === '42703') {
        console.warn('[customer] Account head tables missing — ledger not created');
      } else {
        throw ledgerErr;
      }
    }

    return {
      ...created,
      ledgerAccountId: ledger?.accountId ?? null,
      ledgerParentAccId: ledger?.parentAccId ?? null,
    };
  });
}

export async function updateCustomer(pool, customerId, body, authStaff) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid company on session'); err.status = 400; throw err;
  }
  const id = Number(customerId);
  if (!Number.isFinite(id) || id < 1) {
    const err = new Error('Invalid customerId'); err.status = 400; throw err;
  }
  let code = trimOrEmpty(body.customerCode);
  if (code.length > 20) { const err = new Error('customerCode must be at most 20 characters'); err.status = 400; throw err; }
  const name = trimOrEmpty(body.customerName);
  if (!name) { const err = new Error('customerName is required'); err.status = 400; throw err; }
  const userLabel = auditUserName(authStaff);
  return withTransaction(async (client) => {
    const existing = await customerRepo.findCustomerById(client, companyId, id);
    if (!existing) {
      const err = new Error('Customer not found'); err.status = 404; throw err;
    }

    // POS edit often omits code — keep the existing one unless a new code is sent.
    if (!code) code = trimOrEmpty(existing.customerCode);
    if (!code && Boolean(body.newBarcode || body.autoCode)) {
      code = await generateScopedAutoCode(client, {
        tableName: 'biz.customer_master',
        codeColumn: 'customer_code',
        companyId,
        prefix: body.customerCodePrefix || 'CUST',
        padLength: 6,
        maxLength: 20,
      });
    }
    if (!code) { const err = new Error('customerCode is required'); err.status = 400; throw err; }

    const branchId = authStaff.branch_id != null ? Number(authStaff.branch_id) : null;
    const parentAccId = body.parentAccId ?? body.customerParentAccId ?? null;

    const updated = await customerRepo.updateCustomer(client, companyId, id, {
      customerCode: code,
      customerName: name.slice(0, 200),
      companyName: sliceOrNull(body.companyName, 200),
      customerTaxRegNo: sliceOrNull(body.taxRegNo ?? body.customerTaxRegNo, 100),
      contactPerson: sliceOrNull(body.contactPerson, 200),
      designation: sliceOrNull(body.designation, 200),
      address: sliceOrNull(body.address, 300),
      addressArabic: sliceOrNull(body.addressArabic, 300),
      poBox: sliceOrNull(body.poBox, 15),
      countryName: sliceOrNull(body.country, 100),
      cityName: sliceOrNull(body.city, 100),
      telephone: sliceOrNull(body.telephone, 15),
      fax: sliceOrNull(body.faxNo ?? body.fax, 15),
      email: sliceOrNull(body.email, 75),
      mobileNo: sliceOrNull(body.mobileNo, 25),
      paymentMode: sliceOrNull(body.paymentMode, 50),
      creditBalance: parseMoney(body.creditBalance, 0),
      creditLimit: parseMoney(body.creditLimit, 0),
      creditPeriod: parseIntNonNeg(body.creditPeriodDays ?? body.creditPeriod, 0),
      customerType: sliceOrNull(body.customerType, 50),
      managedBy: parseManagedBy(body, authStaff),
      loyaltyStatus: loyaltyFromForm(body.loyaltyCustStatus ?? body.loyaltyStatus),
      creditStatus: creditStatusFromForm(body.creditStatus),
      remarks: sliceOrNull(body.remarks, 750),
      modifiedBy: userLabel,
    });
    if (!updated) {
      const err = new Error('Customer not found'); err.status = 404; throw err;
    }

    let ledger = null;
    try {
      await client.query('SAVEPOINT customer_ledger');
      ledger = await partyLedger.syncCustomerLedger(client, {
        companyId,
        branchId,
        customerCode: code,
        customerName: name.slice(0, 200),
        previousCode: existing.customerCode,
        parentAccId,
      });
      await client.query('RELEASE SAVEPOINT customer_ledger');
    } catch (ledgerErr) {
      await client.query('ROLLBACK TO SAVEPOINT customer_ledger').catch(() => {});
      if (ledgerErr.code === '42P01' || ledgerErr.code === '42703') {
        console.warn('[customer] Account head tables missing — ledger not updated');
      } else {
        throw ledgerErr;
      }
    }

    return {
      ...updated,
      ledgerAccountId: ledger?.accountId ?? null,
      ledgerParentAccId: ledger?.parentAccId ?? null,
    };
  });
}

export async function listCustomers(pool, authStaff, limitQuery, searchQuery = '') {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid company on session');
    err.status = 400;
    throw err;
  }
  const limit = limitQuery != null ? Number(limitQuery) : 200;
  return customerRepo.listCustomersByCompany(pool, companyId, limit, searchQuery);
}

/** Create or refresh customer sub-ledger in chart of accounts. */
export async function postCustomerLedger(pool, customerId, authStaff, body = {}) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid company on session');
    err.status = 400;
    throw err;
  }
  const id = Number(customerId);
  if (!Number.isFinite(id) || id < 1) {
    const err = new Error('Invalid customerId');
    err.status = 400;
    throw err;
  }

  return withTransaction(async (client) => {
    const customer = await customerRepo.findCustomerById(client, companyId, id);
    if (!customer) {
      const err = new Error('Customer not found');
      err.status = 404;
      throw err;
    }

    const branchId = authStaff.branch_id != null ? Number(authStaff.branch_id) : null;
    const parentAccId = body.parentAccId ?? body.customerParentAccId ?? null;

    const ledger = await partyLedger.syncCustomerLedger(client, {
      companyId,
      branchId,
      customerCode: customer.customerCode,
      customerName: customer.customerName,
      parentAccId,
    });

    return {
      customerId: id,
      customerCode: customer.customerCode,
      ledgerAccountId: ledger.accountId,
      ledgerParentAccId: ledger.parentAccId,
      created: ledger.created,
      message: ledger.created
        ? 'Customer ledger created in chart of accounts'
        : 'Customer ledger already exists — updated',
    };
  });
}
