/**
 * Dashboard Controller — HTTP handlers for all dashboard endpoints.
 * Calls services and returns JSON responses.
 */

import * as dashboardService from '../services/dashboard.service.js';
import { pool } from '../../config/db.js';

// Counter Close Endpoints

export async function getCounterCloseSummary(req, res) {
  try {
    const { date = new Date().toISOString().split('T')[0] } = req.query;
    const companyId = Number(req.authStaff.company_id);
    const branchId = Number(req.authStaff.branch_id);

    const summary = await dashboardService.getCounterCloseSummary(pool, {
      companyId,
      branchId,
      date,
    }, req.authStaff);

    res.json(summary);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
}

export async function getPendingBills(req, res) {
  try {
    const companyId = Number(req.authStaff.company_id);
    const branchId = Number(req.authStaff.branch_id);

    const data = await dashboardService.getPendingBills(pool, {
      companyId,
      branchId,
    }, req.authStaff);

    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
}

export async function closeShift(req, res) {
  try {
    const { shiftId } = req.params;
    const { actualCash, notes } = req.body;

    if (!actualCash) {
      const err = new Error('Actual cash amount is required');
      err.status = 400;
      throw err;
    }

    const companyId = Number(req.authStaff.company_id);
    const branchId = Number(req.authStaff.branch_id);

    const result = await dashboardService.closeShift(pool, {
      shiftId,
      companyId,
      branchId,
      actualCash,
      notes,
    }, req.authStaff);

    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
}

// Sales Endpoints

export async function getDailySales(req, res) {
  try {
    const { from, to } = req.query;

    if (!from || !to) {
      const err = new Error('Date range (from, to) is required');
      err.status = 400;
      throw err;
    }

    const companyId = Number(req.authStaff.company_id);
    const branchId = Number(req.authStaff.branch_id);

    const data = await dashboardService.getDailySales(pool, {
      companyId,
      branchId,
      fromDate: from,
      toDate: to,
    }, req.authStaff);

    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
}

export async function getSalesByProduct(req, res) {
  try {
    const { from, to } = req.query;

    if (!from || !to) {
      const err = new Error('Date range (from, to) is required');
      err.status = 400;
      throw err;
    }

    const companyId = Number(req.authStaff.company_id);
    const branchId = Number(req.authStaff.branch_id);

    const data = await dashboardService.getSalesByProduct(pool, {
      companyId,
      branchId,
      fromDate: from,
      toDate: to,
    }, req.authStaff);

    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
}

export async function getSalesByPaymentMethod(req, res) {
  try {
    const { from, to } = req.query;

    if (!from || !to) {
      const err = new Error('Date range (from, to) is required');
      err.status = 400;
      throw err;
    }

    const companyId = Number(req.authStaff.company_id);
    const branchId = Number(req.authStaff.branch_id);

    const data = await dashboardService.getSalesByPaymentMethod(pool, {
      companyId,
      branchId,
      fromDate: from,
      toDate: to,
    }, req.authStaff);

    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
}

// Staff Endpoints

export async function getStaffPerformance(req, res) {
  try {
    const { from, to } = req.query;

    if (!from || !to) {
      const err = new Error('Date range (from, to) is required');
      err.status = 400;
      throw err;
    }

    const companyId = Number(req.authStaff.company_id);
    const branchId = Number(req.authStaff.branch_id);

    const data = await dashboardService.getStaffPerformance(pool, {
      companyId,
      branchId,
      fromDate: from,
      toDate: to,
    }, req.authStaff);

    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
}

// Inventory Endpoints

export async function getInventoryStock(req, res) {
  try {
    const companyId = Number(req.authStaff.company_id);
    const branchId = Number(req.authStaff.branch_id);

    const data = await dashboardService.getInventoryStock(pool, {
      companyId,
      branchId,
    }, req.authStaff);

    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
}

// Customer Endpoints

export async function getCustomerLedger(req, res) {
  try {
    const companyId = Number(req.authStaff.company_id);
    const branchId = Number(req.authStaff.branch_id);

    const data = await dashboardService.getCustomerLedger(pool, {
      companyId,
      branchId,
    }, req.authStaff);

    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
}

export async function getUnpaidBills(req, res) {
  try {
    const companyId = Number(req.authStaff.company_id);
    const branchId = Number(req.authStaff.branch_id);

    const data = await dashboardService.getUnpaidBills(pool, {
      companyId,
      branchId,
    }, req.authStaff);

    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
}
