import * as exchangeService from '../services/exchange.service.js';

function handleError(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: fallback });
}

export async function listCurrencies(req, res) {
  try {
    const currencies = await exchangeService.listCurrencies(req.authStaff);
    return res.json({ currencies });
  } catch (err) {
    return handleError(res, err, 'Could not load currencies');
  }
}

export async function activateCurrency(req, res) {
  try {
    const result = await exchangeService.activateCurrency(req.authStaff, req.params.code);
    return res.json(result);
  } catch (err) {
    return handleError(res, err, 'Could not activate currency');
  }
}

export async function deactivateCurrency(req, res) {
  try {
    const result = await exchangeService.deactivateCurrency(req.authStaff, req.params.code);
    return res.json(result);
  } catch (err) {
    return handleError(res, err, 'Could not deactivate currency');
  }
}

export async function setBaseCurrency(req, res) {
  try {
    const result = await exchangeService.setBaseCurrency(req.authStaff, req.params.code);
    return res.json(result);
  } catch (err) {
    return handleError(res, err, 'Could not set base currency');
  }
}

export async function listRates(req, res) {
  try {
    const rates = await exchangeService.listRates(req.authStaff, req.query);
    return res.json({ rates });
  } catch (err) {
    return handleError(res, err, 'Could not load exchange rates');
  }
}

export async function createRate(req, res) {
  try {
    const rate = await exchangeService.createRate(req.authStaff, req.body);
    return res.status(201).json(rate);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'A rate for this currency pair and date already exists' });
    }
    return handleError(res, err, 'Could not create exchange rate');
  }
}

export async function updateRate(req, res) {
  try {
    const rate = await exchangeService.updateRate(req.authStaff, req.params.rateId, req.body);
    return res.json(rate);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'A rate for this currency pair and date already exists' });
    }
    return handleError(res, err, 'Could not update exchange rate');
  }
}

export async function deleteRate(req, res) {
  try {
    const result = await exchangeService.deleteRate(req.authStaff, req.params.rateId);
    return res.json(result);
  } catch (err) {
    return handleError(res, err, 'Could not delete exchange rate');
  }
}

export async function getLatestRate(req, res) {
  try {
    const rate = await exchangeService.getLatestRate(req.authStaff, req.query.from, req.query.to);
    return res.json(rate);
  } catch (err) {
    return handleError(res, err, 'Could not fetch latest rate');
  }
}
