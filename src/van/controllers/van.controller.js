import * as vanService from '../services/van.service.js';

function handleError(res, err, fallback) {
  if (err.status) {
    return res.status(err.status).json({ message: err.message });
  }
  console.error(err);
  return res.status(500).json({ message: fallback });
}

/** POST /api/van/login */
export async function login(req, res) {
  try {
    const result = await vanService.login({
      username: req.body?.login ?? req.body?.username,
      password: req.body?.password,
    });
    return res.json(result);
  } catch (err) {
    return handleError(res, err, 'Login failed');
  }
}

/** GET /api/van/day-summary?date=YYYY-MM-DD */
export async function daySummary(req, res) {
  try {
    const result = await vanService.getDaySummary(req.authStaff, req.query.date);
    return res.json(result);
  } catch (err) {
    return handleError(res, err, 'Could not load summary');
  }
}

/** GET /api/van/payment-accounts */
export async function paymentAccounts(req, res) {
  try {
    const result = await vanService.getPaymentAccounts(req.authStaff);
    return res.json({ accounts: result });
  } catch (err) {
    return handleError(res, err, 'Could not load payment accounts');
  }
}

/** POST /api/van/sales */
export async function createSale(req, res) {
  try {
    const result = await vanService.createSale(req.authStaff, req.body);
    return res.status(201).json(result);
  } catch (err) {
    if (err.status === 422 && err.requiresOverride) {
      return res.status(422).json({
        message: err.message,
        requiresOverride: true,
        warnings: err.warnings ?? [],
      });
    }
    return handleError(res, err, 'Could not create sale');
  }
}

/** GET /api/van/products */
export async function products(req, res) {
  try {
    const result = await vanService.getProducts(req.authStaff);
    return res.json({ products: result });
  } catch (err) {
    return handleError(res, err, 'Could not load products');
  }
}

/** GET /api/van/customers?search=&limit= */
export async function customers(req, res) {
  try {
    const result = await vanService.getCustomers(req.authStaff, {
      search: req.query.search ?? req.query.q,
      limit:  req.query.limit,
    });
    return res.json({ customers: result });
  } catch (err) {
    return handleError(res, err, 'Could not load customers');
  }
}

/** GET /api/van/dashboard */
export async function dashboard(req, res) {
  try {
    const result = await vanService.getDashboard(req.authStaff);
    return res.json(result);
  } catch (err) {
    return handleError(res, err, 'Could not load dashboard');
  }
}
