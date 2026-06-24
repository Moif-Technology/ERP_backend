import * as customerReceiptService from '../services/customerReceipt.service.js';

function handleError(res, err, fallbackMsg) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.code === '42P01') return res.status(503).json({ message: 'Accounts tables missing. Run migrations.' });
  console.error(err);
  return res.status(500).json({ message: fallbackMsg });
}

export async function getOutstandingBills(req, res) {
  try {
    const data = await customerReceiptService.listCustomerReceiptOutstanding(
      req.authStaff,
      Number(req.params.customerId),
      req.query,
    );
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not load outstanding bills');
  }
}

export async function getReceiptByVoucher(req, res) {
  try {
    const data = await customerReceiptService.getCustomerReceiptByVoucher(
      req.authStaff,
      Number(req.params.voucherMasterId),
    );
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not load receipt');
  }
}

export async function getReceipt(req, res) {
  try {
    const data = await customerReceiptService.getCustomerReceipt(
      req.authStaff,
      Number(req.params.transactionId),
      req.query.branchId,
    );
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not load receipt');
  }
}

export async function saveReceipt(req, res) {
  try {
    const data = await customerReceiptService.saveCustomerReceipt(req.authStaff, req.body);
    return res.status(201).json(data);
  } catch (err) {
    return handleError(res, err, 'Could not save customer receipt');
  }
}

export async function updateReceipt(req, res) {
  try {
    const data = await customerReceiptService.updateCustomerReceipt(
      req.authStaff,
      Number(req.params.transactionId),
      req.body,
    );
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not update customer receipt');
  }
}

export async function postReceipt(req, res) {
  try {
    const data = await customerReceiptService.postCustomerReceipt(
      req.authStaff,
      Number(req.params.transactionId),
      req.query,
    );
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not post customer receipt');
  }
}

export async function unpostReceipt(req, res) {
  try {
    const data = await customerReceiptService.unpostCustomerReceipt(
      req.authStaff,
      Number(req.params.transactionId),
      req.query,
    );
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not unpost customer receipt');
  }
}

export async function clearPdcReceipt(req, res) {
  try {
    const data = await customerReceiptService.clearPdcCustomerReceipt(
      req.authStaff,
      Number(req.params.transactionId),
      req.query,
    );
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not clear PDC');
  }
}

export async function reconcileBankReceipt(req, res) {
  try {
    const data = await customerReceiptService.reconcileBankCustomerReceipt(
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
