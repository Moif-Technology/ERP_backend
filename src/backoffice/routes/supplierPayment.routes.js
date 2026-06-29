import { Router } from 'express';
import * as supplierPaymentController from '../controllers/supplierPayment.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const supplierPaymentRouter = Router();

supplierPaymentRouter.use(authMiddleware);
supplierPaymentRouter.use(requireAnyFeature(['backoffice.vouchers', 'backoffice.accounts', 'accounts.vouchers']));

supplierPaymentRouter.get('/payments/by-voucher/:voucherMasterId', supplierPaymentController.getPaymentByVoucher);
supplierPaymentRouter.get('/payments/:transactionId', supplierPaymentController.getPayment);
supplierPaymentRouter.put('/payments/:transactionId', supplierPaymentController.updatePayment);
supplierPaymentRouter.post('/payments/:transactionId/post', supplierPaymentController.postPayment);
supplierPaymentRouter.post('/payments/:transactionId/unpost', supplierPaymentController.unpostPayment);
supplierPaymentRouter.post('/payments/:transactionId/clear-pdc', supplierPaymentController.clearPdcPayment);
supplierPaymentRouter.post('/payments/:transactionId/bank-reconcile', supplierPaymentController.reconcileBankPayment);
supplierPaymentRouter.get('/:supplierId/outstanding-bills', supplierPaymentController.getOutstandingBills);
supplierPaymentRouter.post('/', supplierPaymentController.savePayment);
