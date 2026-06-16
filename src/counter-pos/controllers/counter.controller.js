import * as counterService from '../services/counter.service.js';

function handleError(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: fallback });
}

/** GET /api/counter-pos/counter/summary?counterNo=1 */
export async function getSummary(req, res) {
  try {
    const data = await counterService.getSummary(req.authStaff, req.query);
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Failed to get counter summary');
  }
}

/** POST /api/counter-pos/counter/close */
export async function closeCounter(req, res) {
  try {
    const result = await counterService.closeCounter(req.authStaff, req.body);
    return res.status(201).json(result);
  } catch (err) {
    return handleError(res, err, 'Failed to close counter');
  }
}

/** POST /api/counter-pos/counter/cash-in-out */
export async function addCashInOut(req, res) {
  try {
    const result = await counterService.addCashInOut(req.authStaff, req.body);
    return res.status(201).json(result);
  } catch (err) {
    return handleError(res, err, 'Failed to save cash in/out');
  }
}

/** GET /api/counter-pos/counter/cash-in-out?counterNo=1 */
export async function getCashInOutList(req, res) {
  try {
    const list = await counterService.getCashInOutList(req.authStaff, req.query);
    return res.json(list);
  } catch (err) {
    return handleError(res, err, 'Failed to get cash in/out list');
  }
}

/** GET /api/counter-pos/counter/cash-in-out/report */
export async function getCashInOutReport(req, res) {
  try {
    const data = await counterService.getCashInOutReport(req.authStaff, req.query);
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Failed to load cash in/out report');
  }
}

/** GET /api/counter-pos/counter/history?counterNo=1&limit=30 */
export async function getHistory(req, res) {
  try {
    const closes = await counterService.getHistory(req.authStaff, req.query);
    return res.json({ closes });
  } catch (err) {
    return handleError(res, err, 'Failed to get counter close history');
  }
}

/** GET /api/counter-pos/counter/history/:closeId */
export async function getCloseDetail(req, res) {
  try {
    const record = await counterService.getCloseDetail(req.authStaff, req.params.closeId);
    return res.json(record);
  } catch (err) {
    return handleError(res, err, 'Failed to get counter close detail');
  }
}
