import { Router } from 'express';
import * as customerReceiptController from '../controllers/customerReceipt.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const customerReceiptRouter = Router();

customerReceiptRouter.use(authMiddleware);
customerReceiptRouter.use(requireAnyFeature(['backoffice.vouchers', 'backoffice.accounts', 'accounts.vouchers']));

customerReceiptRouter.get('/receipts/by-voucher/:voucherMasterId', customerReceiptController.getReceiptByVoucher);
customerReceiptRouter.get('/receipts/:transactionId', customerReceiptController.getReceipt);
customerReceiptRouter.put('/receipts/:transactionId', customerReceiptController.updateReceipt);
customerReceiptRouter.post('/receipts/:transactionId/post', customerReceiptController.postReceipt);
customerReceiptRouter.post('/receipts/:transactionId/unpost', customerReceiptController.unpostReceipt);
customerReceiptRouter.post('/receipts/:transactionId/clear-pdc', customerReceiptController.clearPdcReceipt);
customerReceiptRouter.post('/receipts/:transactionId/bank-reconcile', customerReceiptController.reconcileBankReceipt);
customerReceiptRouter.get('/:customerId/outstanding-bills', customerReceiptController.getOutstandingBills);
customerReceiptRouter.post('/', customerReceiptController.saveReceipt);
