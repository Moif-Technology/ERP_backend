import { pool } from '../../config/db.js';
import * as voucherService from '../services/voucher.service.js';
import * as financialReportService from '../services/financialReport.service.js';
import * as trialBalanceTreeService from '../services/trialBalanceTree.service.js';
import * as profitAndLossTreeService from '../services/profitAndLossTree.service.js';
import * as balanceSheetTreeService from '../services/balanceSheetTree.service.js';
import * as accountsDashboardService from '../services/accountsDashboard.service.js';

function handleError(res, err, fallbackMsg) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.code === '42P01') return res.status(503).json({ message: 'Voucher tables missing. Run migration 035.' });
  console.error(err);
  return res.status(500).json({ message: fallbackMsg });
}

export async function listVouchers(req, res) {
  try {
    return res.json(await voucherService.listVouchers(pool, req.authStaff, req.query));
  } catch (err) { return handleError(res, err, 'Could not load vouchers'); }
}

export async function getAccountsDashboard(req, res) {
  try {
    return res.json({
      dashboard: await accountsDashboardService.getAccountsDashboard(pool, req.authStaff, req.query),
    });
  } catch (err) { return handleError(res, err, 'Could not load accounts dashboard'); }
}

export async function getVoucher(req, res) {
  try {
    return res.json(await voucherService.getVoucher(pool, req.authStaff, Number(req.params.id)));
  } catch (err) { return handleError(res, err, 'Could not load voucher'); }
}

export async function createVoucher(req, res) {
  try {
    const data = await voucherService.createVoucher(pool, req.authStaff, req.body);
    return res.status(201).json(data);
  } catch (err) { return handleError(res, err, 'Could not create voucher'); }
}

export async function updateVoucher(req, res) {
  try {
    return res.json(await voucherService.updateVoucher(pool, req.authStaff, Number(req.params.id), req.body));
  } catch (err) { return handleError(res, err, 'Could not update voucher'); }
}

export async function postVoucher(req, res) {
  try {
    return res.json(await voucherService.postVoucher(pool, req.authStaff, Number(req.params.id)));
  } catch (err) { return handleError(res, err, 'Could not post voucher'); }
}

export async function unpostVoucher(req, res) {
  try {
    return res.json(await voucherService.unpostVoucher(pool, req.authStaff, Number(req.params.id)));
  } catch (err) { return handleError(res, err, 'Could not unpost voucher'); }
}

export async function deleteVoucher(req, res) {
  try {
    return res.json(await voucherService.deleteVoucher(pool, req.authStaff, Number(req.params.id)));
  } catch (err) { return handleError(res, err, 'Could not delete voucher'); }
}

export async function listVoucherTypes(req, res) {
  try {
    return res.json(await voucherService.listVoucherTypes(pool, req.authStaff));
  } catch (err) { return handleError(res, err, 'Could not load voucher types'); }
}

export async function peekNextVoucherNo(req, res) {
  try {
    return res.json(await voucherService.peekNextVoucherNo(pool, req.authStaff, req.query));
  } catch (err) { return handleError(res, err, 'Could not preview next voucher number'); }
}

export async function getLedgerTransactions(req, res) {
  try {
    return res.json(await voucherService.getLedgerTransactions(pool, req.authStaff, Number(req.params.accountId), req.query));
  } catch (err) { return handleError(res, err, 'Could not load ledger'); }
}

export async function getAgingSummary(req, res) {
  try {
    return res.json(await voucherService.getAgingSummary(pool, req.authStaff, req.query));
  } catch (err) { return handleError(res, err, 'Could not load aging summary'); }
}

export async function getAgingDetail(req, res) {
  try {
    return res.json(await voucherService.getAgingDetail(pool, req.authStaff, req.params.accountId, req.query));
  } catch (err) { return handleError(res, err, 'Could not load aging detail'); }
}

export async function getTrialBalance(req, res) {
  try {
    const view = String(req.query.view || '').toLowerCase();
    if (view === 'tree') {
      return res.json(await trialBalanceTreeService.getTrialBalanceTree(pool, req.authStaff, req.query));
    }
    return res.json(await financialReportService.getFullTrialBalance(pool, req.authStaff, req.query));
  } catch (err) { return handleError(res, err, 'Could not load trial balance'); }
}

export async function getBalanceSheet(req, res) {
  try {
    const view = String(req.query.view || '').toLowerCase();
    if (view === 'tree') {
      return res.json(await balanceSheetTreeService.getBalanceSheetTree(pool, req.authStaff, req.query));
    }
    return res.json(await financialReportService.getBalanceSheet(pool, req.authStaff, req.query));
  } catch (err) { return handleError(res, err, 'Could not load balance sheet'); }
}

export async function getProfitAndLoss(req, res) {
  try {
    const view = String(req.query.view || '').toLowerCase();
    if (view === 'tree') {
      return res.json(await profitAndLossTreeService.getProfitAndLossTree(pool, req.authStaff, req.query));
    }
    return res.json(await financialReportService.getProfitAndLoss(pool, req.authStaff, req.query));
  } catch (err) { return handleError(res, err, 'Could not load profit and loss'); }
}

export async function listPartyAccounts(req, res) {
  try {
    return res.json(await financialReportService.listPartyAccounts(pool, req.authStaff, req.query));
  } catch (err) { return handleError(res, err, 'Could not load party accounts'); }
}
