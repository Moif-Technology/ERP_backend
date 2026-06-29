import * as supplierPaymentService from '../services/supplierPayment.service.js';

function handleError(res, err, fallbackMsg) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.code === '42P01') return res.status(503).json({ message: 'Accounts tables missing. Run migrations.' });
  console.error(err);
  return res.status(500).json({ message: fallbackMsg });
}

export async function getOutstandingBills(req, res) {
  try {
    const data = await supplierPaymentService.listSupplierPaymentOutstanding(
      req.authStaff,
      Number(req.params.supplierId),
      req.query,
    );
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not load outstanding bills');
  }
}

export async function getPaymentByVoucher(req, res) {
  try {
    const data = await supplierPaymentService.getSupplierPaymentByVoucher(
      req.authStaff,
      Number(req.params.voucherMasterId),
    );
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not load supplier payment');
  }
}

export async function getPayment(req, res) {
  try {
    const data = await supplierPaymentService.getSupplierPayment(
      req.authStaff,
      Number(req.params.transactionId),
      req.query.branchId,
    );
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not load supplier payment');
  }
}

export async function savePayment(req, res) {
  try {
    const data = await supplierPaymentService.saveSupplierPayment(req.authStaff, req.body);
    return res.status(201).json(data);
  } catch (err) {
    return handleError(res, err, 'Could not save supplier payment');
  }
}

export async function updatePayment(req, res) {
  try {
    const data = await supplierPaymentService.updateSupplierPayment(
      req.authStaff,
      Number(req.params.transactionId),
      req.body,
    );
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not update supplier payment');
  }
}

export async function postPayment(req, res) {
  try {
    const data = await supplierPaymentService.postSupplierPayment(
      req.authStaff,
      Number(req.params.transactionId),
      req.query,
    );
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not post supplier payment');
  }
}

export async function unpostPayment(req, res) {
  try {
    const data = await supplierPaymentService.unpostSupplierPayment(
      req.authStaff,
      Number(req.params.transactionId),
      req.query,
    );
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not unpost supplier payment');
  }
}

export async function clearPdcPayment(req, res) {
  try {
    const data = await supplierPaymentService.clearPdcSupplierPayment(
      req.authStaff,
      Number(req.params.transactionId),
      req.query,
    );
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not clear PDC');
  }
}

export async function reconcileBankPayment(req, res) {
  try {
    const data = await supplierPaymentService.reconcileBankSupplierPayment(
      req.authStaff,
      Number(req.params.transactionId),
      req.body,
      req.query,
    );
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not reconcile bank');
  }
}
