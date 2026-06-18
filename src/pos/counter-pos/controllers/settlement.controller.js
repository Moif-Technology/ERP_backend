import * as settlementService from '../services/settlement.service.js';

function handleError(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: fallback });
}

/** GET /api/counter-pos/settlement/credit-customers?q=&limit= */
export async function listCreditCustomers(req, res) {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Number(req.query.limit) || 200, 200);
    const customers = await settlementService.listCreditCustomers(req.authStaff, q, limit);
    return res.json({ customers });
  } catch (err) {
    return handleError(res, err, 'Failed to load credit customers');
  }
}

/** GET /api/counter-pos/settlement/customers/:customerId/bills */
export async function getOutstandingBills(req, res) {
  try {
    const data = await settlementService.getCustomerOutstandingBills(
      req.authStaff,
      req.params.customerId,
    );
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Failed to load outstanding bills');
  }
}

/** GET /api/counter-pos/settlement/history?customerId=&dateFrom=&dateTo= */
export async function listHistory(req, res) {
  try {
    const receipts = await settlementService.listSettlementHistory(req.authStaff, req.query);
    return res.json({ receipts });
  } catch (err) {
    return handleError(res, err, 'Failed to load settlement history');
  }
}

/** GET /api/counter-pos/settlement/receipts/:transactionId */
export async function getReceipt(req, res) {
  try {
    const receipt = await settlementService.getSettlementReceipt(
      req.authStaff,
      req.params.transactionId,
    );
    return res.json(receipt);
  } catch (err) {
    return handleError(res, err, 'Failed to load receipt');
  }
}

/** POST /api/counter-pos/settlement/save */
export async function saveSettlement(req, res) {
  try {
    const result = await settlementService.saveCreditSettlement(req.authStaff, req.body);
    return res.status(201).json(result);
  } catch (err) {
    return handleError(res, err, 'Settlement failed');
  }
}
