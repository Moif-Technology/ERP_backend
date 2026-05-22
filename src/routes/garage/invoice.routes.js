import { Router } from 'express';
import * as ctrl from '../../controllers/garage/invoice.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

export const invoiceRouter = Router();

invoiceRouter.use(authMiddleware);
invoiceRouter.get('/', ctrl.listInvoices);
invoiceRouter.get('/by-jobcard/:jcNo', ctrl.getInvoiceByJobCard);
invoiceRouter.get('/:id', ctrl.getInvoiceById);
invoiceRouter.post('/', ctrl.createInvoice);
invoiceRouter.put('/:id', ctrl.updateInvoice);
invoiceRouter.post('/:id/post', ctrl.postInvoice);
invoiceRouter.patch('/:id/post', ctrl.postInvoice);
invoiceRouter.post('/:id/cancel', ctrl.cancelInvoice);
invoiceRouter.patch('/:id/cancel', ctrl.cancelInvoice);
