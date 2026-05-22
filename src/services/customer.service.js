import { withTransaction } from '../config/db.js';
import * as customerRepo from '../repositories/customer.repository.js';
import { actorStaffPk } from '../utils/actorStaff.js';
import { generateScopedAutoCode } from '../utils/autoCode.js';
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

  const userLabel = (authStaff.staff_name || '').slice(0, 50) || 'system';

  const customerPrefix = sliceOrNull(body.customerPrefix, 1);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `biz.customer_master:${companyId}`,
    ]);
    await assertLimitAvailable({
      companyId,
      limitCode: 'customers',
      countFn: customerRepo.countActiveCustomers,
      db: client,
    });
    if (!code && wantsAutoCode) {
      code = await generateScopedAutoCode(client, {
        tableName: 'biz.customer_master',
        codeColumn: 'customer_code',
        companyId,
        prefix: body.customerCodePrefix || 'CUST',
        padLength: 6,
        maxLength: 20,
      });
    }
    if (!code) {
      const err = new Error('customerCode is required');
      err.status = 400;
      throw err;
    }
    const customerId = await customerRepo.nextCustomerId(client, companyId);
    return customerRepo.insertCustomer(client, {
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
  const userLabel = (authStaff.staff_name || '').slice(0, 50) || 'system';
  return withTransaction(async (client) => {
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
    return updated;
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
