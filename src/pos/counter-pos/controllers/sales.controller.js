import * as salesService from '../services/sales.service.js';

function handleError(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  const detail = err.message && !err.message.includes('password') ? err.message : null;
  return res.status(500).json({ message: detail || fallback });
}

/** POST /api/counter-pos/sales/hold */
export async function holdBill(req, res) {
  try {
    const result = await salesService.holdBill(req.authStaff, req.body);
    return res.status(201).json(result);
  } catch (err) {
    return handleError(res, err, 'Failed to hold bill');
  }
}

/** GET /api/counter-pos/sales/held */
export async function getHeldBills(req, res) {
  try {
    const list = await salesService.getHeldBills(req.authStaff);
    return res.json(list);
  } catch (err) {
    return handleError(res, err, 'Failed to get held bills');
  }
}

/** GET /api/counter-pos/sales/held/:salesId */
export async function recallBill(req, res) {
  try {
    const items = await salesService.recallBill(req.authStaff, req.params.salesId);
    return res.json(items);
  } catch (err) {
    return handleError(res, err, 'Failed to recall hold bill');
  }
}

/** DELETE /api/counter-pos/sales/held/:salesId */
export async function cancelHold(req, res) {
  try {
    const result = await salesService.cancelHold(req.authStaff, req.params.salesId);
    return res.json(result);
  } catch (err) {
    return handleError(res, err, 'Failed to cancel hold bill');
  }
}

/** POST /api/counter-pos/sales/delivery */
export async function saveDelivery(req, res) {
  try {
    const result = await salesService.saveDeliveryBill(req.authStaff, req.body);
    return res.status(201).json(result);
  } catch (err) {
    return handleError(res, err, 'Failed to save delivery');
  }
}

/** GET /api/counter-pos/sales/delivery */
export async function getDeliveryBills(req, res) {
  try {
    const list = await salesService.getDeliveryBills(req.authStaff);
    return res.json(list);
  } catch (err) {
    return handleError(res, err, 'Failed to get delivery bills');
  }
}

/** GET /api/counter-pos/sales/delivery/:salesId */
export async function recallDelivery(req, res) {
  try {
    const items = await salesService.recallDeliveryBill(req.authStaff, req.params.salesId);
    return res.json(items);
  } catch (err) {
    return handleError(res, err, 'Failed to recall delivery bill');
  }
}

/** DELETE /api/counter-pos/sales/delivery/:salesId */
export async function cancelDelivery(req, res) {
  try {
    const result = await salesService.cancelDelivery(req.authStaff, req.params.salesId);
    return res.json(result);
  } catch (err) {
    return handleError(res, err, 'Failed to cancel delivery bill');
  }
}

/** POST /api/counter-pos/sales/delivery/:salesId/settle */
export async function settleDelivery(req, res) {
  try {
    const result = await salesService.settleDeliveryBill(
      req.authStaff,
      req.params.salesId,
      req.body,
    );
    return res.json(result);
  } catch (err) {
    return handleError(res, err, 'Failed to settle delivery');
  }
}

export async function settleDeliveryBulk(req, res) {
  try {
    const result = await salesService.settleDeliveryBulk(req.authStaff, req.body);
    return res.json(result);
  } catch (err) {
    return handleError(res, err, 'Failed to settle deliveries');
  }
}

/** GET /api/counter-pos/sales/next-bill-no */
export async function nextBillNo(req, res) {
  try {
    const billNo = await salesService.getNextBillNo(req.authStaff);
    return res.json({ billNo, billNoDisplay: `B-${billNo}` });
  } catch (err) {
    return handleError(res, err, 'Failed to get next bill number');
  }
}

/** GET /api/counter-pos/sales/staff-wise */
export async function staffWiseReport(req, res) {
  try {
    const data = await salesService.getStaffWiseReport(req.authStaff, req.query);
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Failed to get staff wise report');
  }
}

/** GET /api/counter-pos/sales/viewer */
export async function salesViewerList(req, res) {
  try {
    const data = await salesService.listSalesViewer(req.authStaff, req.query);
    return res.json({ bills: data });
  } catch (err) {
    return handleError(res, err, 'Failed to load sales viewer');
  }
}

/** GET /api/counter-pos/sales/viewer/:salesId */
export async function salesViewerBill(req, res) {
  try {
    const data = await salesService.getSalesViewerBill(req.authStaff, req.params.salesId);
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Failed to load bill detail');
  }
}

/** POST /api/counter-pos/sales/save */
export async function saveBill(req, res) {
  try {
    const result = await salesService.saveBill(req.authStaff, req.body);
    return res.status(201).json(result);
  } catch (err) {
    return handleError(res, err, 'Failed to save bill');
  }
}
