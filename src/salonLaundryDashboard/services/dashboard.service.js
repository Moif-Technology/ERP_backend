/**
 * Dashboard Service — Business logic for all dashboard queries.
 * Calls repositories to fetch data and formats for API responses.
 */

import * as counterRepo from '../repositories/counter.repository.js';
import * as salesRepo from '../repositories/sales.repository.js';
import * as staffRepo from '../repositories/staff.repository.js';
import * as inventoryRepo from '../repositories/inventory.repository.js';
import * as customerRepo from '../repositories/customer.repository.js';

export async function getCounterCloseSummary(pool, { companyId, branchId, date }, authStaff) {
  const client = await pool.connect();
  try {
    const summary = await counterRepo.getDailySummary(client, { companyId, branchId, date });
    return summary;
  } finally {
    client.release();
  }
}

export async function getPendingBills(pool, { companyId, branchId }, authStaff) {
  const client = await pool.connect();
  try {
    const bills = await counterRepo.getPendingBills(client, { companyId, branchId });
    return { bills, count: bills.length };
  } finally {
    client.release();
  }
}

export async function closeShift(pool, { shiftId, companyId, branchId, actualCash, notes }, authStaff) {
  const client = await pool.connect();
  try {
    const result = await counterRepo.insertShiftClose(client, {
      shiftId,
      companyId,
      branchId,
      actualCash: Number(actualCash),
      notes: notes || '',
    });

    if (!result) {
      const err = new Error('Shift not found or already closed');
      err.status = 404;
      throw err;
    }

    return {
      success: true,
      message: 'Shift closed successfully',
      shift_id: result.shift_id,
    };
  } finally {
    client.release();
  }
}

export async function getDailySales(pool, { companyId, branchId, fromDate, toDate }, authStaff) {
  const client = await pool.connect();
  try {
    const summary = await salesRepo.getSalesSummary(client, { companyId, branchId, fromDate, toDate });
    return summary;
  } finally {
    client.release();
  }
}

export async function getSalesByProduct(pool, { companyId, branchId, fromDate, toDate }, authStaff) {
  const client = await pool.connect();
  try {
    const products = await salesRepo.getSalesByProduct(client, { companyId, branchId, fromDate, toDate });
    return { products };
  } finally {
    client.release();
  }
}

export async function getSalesByPaymentMethod(pool, { companyId, branchId, fromDate, toDate }, authStaff) {
  const client = await pool.connect();
  try {
    const methods = await salesRepo.getSalesByPaymentMethod(client, { companyId, branchId, fromDate, toDate });
    return { methods };
  } finally {
    client.release();
  }
}

export async function getStaffPerformance(pool, { companyId, branchId, fromDate, toDate }, authStaff) {
  const client = await pool.connect();
  try {
    const staff = await staffRepo.getStaffPerformance(client, { companyId, branchId, fromDate, toDate });
    return { staff };
  } finally {
    client.release();
  }
}

export async function getInventoryStock(pool, { companyId, branchId }, authStaff) {
  const client = await pool.connect();
  try {
    const items = await inventoryRepo.getStockLevels(client, { companyId, branchId });
    return { items };
  } finally {
    client.release();
  }
}

export async function getCustomerLedger(pool, { companyId, branchId }, authStaff) {
  const client = await pool.connect();
  try {
    const entries = await customerRepo.getCustomerLedger(client, { companyId, branchId });
    return { entries };
  } finally {
    client.release();
  }
}

export async function getUnpaidBills(pool, { companyId, branchId }, authStaff) {
  const client = await pool.connect();
  try {
    const bills = await customerRepo.getUnpaidBills(client, { companyId, branchId });
    return { bills };
  } finally {
    client.release();
  }
}
