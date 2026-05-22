import { pool } from '../config/db.js';
import * as repo from '../repositories/exchange.repository.js';

function parseCompanyId(authStaff) {
  const id = Number(authStaff?.company_id);
  if (!Number.isFinite(id) || id < 1) {
    const err = new Error('Invalid session company');
    err.status = 401;
    throw err;
  }
  return id;
}

function actor(authStaff) {
  return String(authStaff?.staff_name || authStaff?.login_name || 'system').slice(0, 50);
}

function parseRateId(raw) {
  const id = Number(raw);
  if (!Number.isFinite(id) || id < 1) {
    const err = new Error('Invalid rateId');
    err.status = 400;
    throw err;
  }
  return Math.trunc(id);
}

function normalizeCurrencyCode(raw, field = 'currencyCode') {
  const code = String(raw || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    const err = new Error(`${field} must be a valid 3-letter ISO 4217 code`);
    err.status = 400;
    throw err;
  }
  return code;
}

function mapCurrency(row) {
  return {
    currencyCode: row.currency_code,
    currencyName: row.currency_name,
    symbol: row.symbol,
    decimalPlaces: Number(row.decimal_places),
    isActive: row.is_active === true || row.is_active === 'true',
    isBase: row.is_base === true || row.is_base === 'true',
    recordStatus: row.record_status,
  };
}

function mapRate(row) {
  return {
    rateId: Number(row.rate_id),
    fromCurrency: row.from_currency,
    toCurrency: row.to_currency,
    rate: row.rate,
    effectiveDate: row.effective_date instanceof Date
      ? row.effective_date.toISOString().slice(0, 10)
      : String(row.effective_date).slice(0, 10),
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? null,
    modifiedBy: row.modified_by ?? null,
    modifiedAt: row.modified_at ?? null,
  };
}

export async function listCurrencies(authStaff) {
  const companyId = parseCompanyId(authStaff);
  const rows = await repo.listAllCurrencies(pool, companyId);
  return rows.map(mapCurrency);
}

export async function activateCurrency(authStaff, code) {
  const companyId = parseCompanyId(authStaff);
  const currencyCode = normalizeCurrencyCode(code);

  const exists = await repo.currencyExists(pool, currencyCode);
  if (!exists) {
    const err = new Error(`Currency ${currencyCode} not found`);
    err.status = 404;
    throw err;
  }

  await repo.activateCurrency(pool, companyId, currencyCode, actor(authStaff));
  return { ok: true, currencyCode };
}

export async function deactivateCurrency(authStaff, code) {
  const companyId = parseCompanyId(authStaff);
  const currencyCode = normalizeCurrencyCode(code);

  const cc = await repo.getCompanyCurrency(pool, companyId, currencyCode);
  if (cc?.is_base) {
    const err = new Error('Cannot deactivate the base currency. Set another currency as base first.');
    err.status = 409;
    throw err;
  }

  const row = await repo.deactivateCurrency(pool, companyId, currencyCode, actor(authStaff));
  if (!row) {
    const err = new Error(`Currency ${currencyCode} is not active for this company`);
    err.status = 404;
    throw err;
  }
  return { ok: true, currencyCode };
}

export async function setBaseCurrency(authStaff, code) {
  const companyId = parseCompanyId(authStaff);
  const currencyCode = normalizeCurrencyCode(code);

  const exists = await repo.currencyExists(pool, currencyCode);
  if (!exists) {
    const err = new Error(`Currency ${currencyCode} not found`);
    err.status = 404;
    throw err;
  }

  await repo.setBaseCurrency(pool, companyId, currencyCode, actor(authStaff));
  return { ok: true, currencyCode };
}

export async function listRates(authStaff, query = {}) {
  const companyId = parseCompanyId(authStaff);
  const filters = {
    from: query.from || null,
    to: query.to || null,
    dateFrom: query.date_from || null,
    dateTo: query.date_to || null,
  };
  const rows = await repo.listRates(pool, companyId, filters);
  return rows.map(mapRate);
}

export async function createRate(authStaff, body) {
  const companyId = parseCompanyId(authStaff);
  const fromCurrency = normalizeCurrencyCode(body?.fromCurrency, 'fromCurrency');
  const toCurrency   = normalizeCurrencyCode(body?.toCurrency,   'toCurrency');

  if (fromCurrency === toCurrency) {
    const err = new Error('fromCurrency and toCurrency must be different');
    err.status = 400;
    throw err;
  }

  const rate = Number(body?.rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    const err = new Error('rate must be a positive number');
    err.status = 400;
    throw err;
  }

  const effectiveDate = body?.effectiveDate;
  if (!effectiveDate || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    const err = new Error('effectiveDate is required (YYYY-MM-DD)');
    err.status = 400;
    throw err;
  }

  const row = await repo.createRate(pool, companyId, {
    fromCurrency, toCurrency, rate, effectiveDate, actor: actor(authStaff),
  });
  return mapRate(row);
}

export async function updateRate(authStaff, rateIdRaw, body) {
  const companyId = parseCompanyId(authStaff);
  const rateId = parseRateId(rateIdRaw);
  const fromCurrency = normalizeCurrencyCode(body?.fromCurrency, 'fromCurrency');
  const toCurrency   = normalizeCurrencyCode(body?.toCurrency,   'toCurrency');

  if (fromCurrency === toCurrency) {
    const err = new Error('fromCurrency and toCurrency must be different');
    err.status = 400;
    throw err;
  }

  const rate = Number(body?.rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    const err = new Error('rate must be a positive number');
    err.status = 400;
    throw err;
  }

  const effectiveDate = body?.effectiveDate;
  if (!effectiveDate || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    const err = new Error('effectiveDate is required (YYYY-MM-DD)');
    err.status = 400;
    throw err;
  }

  const row = await repo.updateRate(pool, companyId, rateId, {
    fromCurrency, toCurrency, rate, effectiveDate, actor: actor(authStaff),
  });
  if (!row) {
    const err = new Error('Exchange rate not found');
    err.status = 404;
    throw err;
  }
  return mapRate(row);
}

export async function deleteRate(authStaff, rateIdRaw) {
  const companyId = parseCompanyId(authStaff);
  const rateId = parseRateId(rateIdRaw);
  const row = await repo.deleteRate(pool, companyId, rateId);
  if (!row) {
    const err = new Error('Exchange rate not found');
    err.status = 404;
    throw err;
  }
  return { ok: true, rateId };
}

export async function getLatestRate(authStaff, from, to) {
  const companyId = parseCompanyId(authStaff);
  const fromCurrency = normalizeCurrencyCode(from, 'from');
  const toCurrency   = normalizeCurrencyCode(to,   'to');

  if (fromCurrency === toCurrency) {
    const err = new Error('from and to must be different');
    err.status = 400;
    throw err;
  }

  const row = await repo.getLatestRate(pool, companyId, fromCurrency, toCurrency);
  if (!row) {
    const err = new Error(`No rate found for ${fromCurrency}→${toCurrency}`);
    err.status = 404;
    throw err;
  }
  return mapRate(row);
}
