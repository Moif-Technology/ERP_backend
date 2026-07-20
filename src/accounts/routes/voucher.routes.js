import { Router } from 'express';
import * as voucherController from '../controllers/voucher.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const voucherRouter = Router();

voucherRouter.use(authMiddleware);

voucherRouter.get(
  '/dashboard',
  requireAnyFeature(['accounts.dashboard', 'accounts', 'backoffice.accounts', 'backoffice.vouchers']),
  voucherController.getAccountsDashboard,
);

voucherRouter.use(requireAnyFeature(['backoffice.accounts', 'backoffice.vouchers', 'accounts', 'accounts.vouchers', 'accounts.ledger']));
voucherRouter.get('/types', voucherController.listVoucherTypes);
voucherRouter.get('/next-number', voucherController.peekNextVoucherNo);
voucherRouter.get('/trial-balance', voucherController.getTrialBalance);
voucherRouter.get('/balance-sheet', voucherController.getBalanceSheet);
voucherRouter.get('/profit-and-loss', voucherController.getProfitAndLoss);
voucherRouter.get('/party-accounts', voucherController.listPartyAccounts);
voucherRouter.get('/aging-summary', voucherController.getAgingSummary);
voucherRouter.get('/aging-detail/:accountId', voucherController.getAgingDetail);
voucherRouter.get('/ledger/:accountId', voucherController.getLedgerTransactions);

voucherRouter.get('/', voucherController.listVouchers);
voucherRouter.get('/:id', voucherController.getVoucher);
voucherRouter.post('/', voucherController.createVoucher);
voucherRouter.put('/:id', voucherController.updateVoucher);
voucherRouter.post('/:id/post', voucherController.postVoucher);
voucherRouter.post('/:id/unpost', voucherController.unpostVoucher);
voucherRouter.delete('/:id', voucherController.deleteVoucher);
