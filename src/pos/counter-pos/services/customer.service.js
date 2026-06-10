import { pool } from '../../../config/db.js';
import * as customerRepo from '../repositories/customer.repository.js';

/**
 * Search customers for the logged-in counter's company.
 * Customers are company-scoped (not branch-scoped) — same as VB CustomerLookupFrm.
 */
export async function searchCustomers(authStaff, q, limit = 30) {
  const companyId = Number(authStaff.company_id);
  const customers = await customerRepo.searchCustomers(pool, companyId, q, limit);

  return customers.map(c => ({
    customerId:    c.customerId,
    customerCode:  c.customerCode,
    customerName:  c.customerName,
    mobileNo:      c.mobileNo    ?? null,
    telephone:     c.telephone   ?? null,
    paymentMode:   c.paymentMode ?? 'CASH',
    creditLimit:   c.creditLimit,
    creditBalance: c.creditBalance,
    osAmount:      c.creditBalance,
    loyaltyStatus: c.loyaltyStatus ?? null,
    customerType:  c.customerType  ?? null,
  }));
}
