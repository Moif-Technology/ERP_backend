import { Router } from 'express';
import * as voucherController from '../controllers/voucher.controller.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAnyFeature } from '../middleware/entitlementMiddleware.js';

export const voucherRouter = Router();

voucherRouter.use(authMiddleware);
voucherRouter.use(requireAnyFeature(['backoffice.accounts', 'backoffice.vouchers']));

voucherRouter.get('/types', voucherController.listVoucherTypes);
voucherRouter.get('/trial-balance', voucherController.getTrialBalance);
voucherRouter.get('/aging-summary', voucherController.getAgingSummary);
voucherRouter.get('/ledger/:accountId', voucherController.getLedgerTransactions);

voucherRouter.get('/', voucherController.listVouchers);
voucherRouter.get('/:id', voucherController.getVoucher);
voucherRouter.post('/', voucherController.createVoucher);
voucherRouter.put('/:id', voucherController.updateVoucher);
voucherRouter.post('/:id/post', voucherController.postVoucher);
voucherRouter.post('/:id/unpost', voucherController.unpostVoucher);
voucherRouter.delete('/:id', voucherController.deleteVoucher);
