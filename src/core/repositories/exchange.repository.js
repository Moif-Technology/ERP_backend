import { withTransaction } from '../../config/db.js';

export async function listAllCurrencies(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT
       cm.currency_code,
       cm.currency_name,
       cm.symbol,
       cm.decimal_places,
       cm.record_status,
       COALESCE(cc.record_status = 'ACTIVE', false) AS is_active,
       COALESCE(cc.is_base, false)                  AS is_base
     FROM core.currency_master cm
     LEFT JOIN core.company_currency cc
            ON cc.currency_code = cm.currency_code
           AND cc.company_id = $1
     WHERE cm.record_status = 'ACTIVE'
     ORDER BY cm.currency_code`,
    [companyId]
  );
  return rows;
}

export async function getCompanyCurrency(pool, companyId, currencyCode) {
  const { rows } = await pool.query(
    `SELECT currency_code, is_base, record_status
     FROM core.company_currency
     WHERE company_id = $1 AND currency_code = $2`,
    [companyId, currencyCode]
  );
  return rows[0] ?? null;
}

export async function currencyExists(pool, currencyCode) {
  const { rows } = await pool.query(
    `SELECT 1 FROM core.currency_master WHERE currency_code = $1 AND record_status = 'ACTIVE'`,
    [currencyCode]
  );
  return rows.length > 0;
}

export async function activateCurrency(pool, companyId, currencyCode, actor) {
  const { rows } = await pool.query(
    `INSERT INTO core.company_currency (company_id, currency_code, is_base, record_status, created_by, modified_by)
     VALUES ($1, $2, false, 'ACTIVE', $3, $3)
     ON CONFLICT (company_id, currency_code)
     DO UPDATE SET record_status = 'ACTIVE', modified_by = $3, modified_at = NOW()
     RETURNING *`,
    [companyId, currencyCode, actor]
  );
  return rows[0];
}

export async function deactivateCurrency(pool, companyId, currencyCode, actor) {
  const { rows } = await pool.query(
    `UPDATE core.company_currency
     SET record_status = 'INACTIVE', is_base = false, modified_by = $3, modified_at = NOW()
     WHERE company_id = $1 AND currency_code = $2 AND is_base = false
     RETURNING *`,
    [companyId, currencyCode, actor]
  );
  return rows[0] ?? null;
}

export async function setBaseCurrency(pool, companyId, currencyCode, actor) {
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE core.company_currency
       SET is_base = false, modified_by = $2, modified_at = NOW()
       WHERE company_id = $1 AND is_base = true`,
      [companyId, actor]
    );
    const { rows } = await client.query(
      `INSERT INTO core.company_currency (company_id, currency_code, is_base, record_status, created_by, modified_by)
       VALUES ($1, $2, true, 'ACTIVE', $3, $3)
       ON CONFLICT (company_id, currency_code)
       DO UPDATE SET is_base = true, record_status = 'ACTIVE', modified_by = $3, modified_at = NOW()
       RETURNING *`,
      [companyId, currencyCode, actor]
    );
    return rows[0];
  });
}

export async function listRates(pool, companyId, { from, to, dateFrom, dateTo } = {}) {
  const conditions = ['er.company_id = $1'];
  const params = [companyId];
  let i = 2;

  if (from) { conditions.push(`er.from_currency = $${i++}`); params.push(from.toUpperCase()); }
  if (to)   { conditions.push(`er.to_currency = $${i++}`);   params.push(to.toUpperCase()); }
  if (dateFrom) { conditions.push(`er.effective_date >= $${i++}`); params.push(dateFrom); }
  if (dateTo)   { conditions.push(`er.effective_date <= $${i++}`); params.push(dateTo); }

  const { rows } = await pool.query(
    `SELECT er.rate_id, er.from_currency, er.to_currency,
            er.rate, er.effective_date, er.created_by, er.created_at,
            er.modified_by, er.modified_at
     FROM core.exchange_rate er
     WHERE ${conditions.join(' AND ')}
     ORDER BY er.effective_date DESC, er.created_at DESC`,
    params
  );
  return rows;
}

export async function getRateById(pool, companyId, rateId) {
  const { rows } = await pool.query(
    `SELECT rate_id, from_currency, to_currency, rate, effective_date,
            created_by, created_at, modified_by, modified_at
     FROM core.exchange_rate
     WHERE company_id = $1 AND rate_id = $2`,
    [companyId, rateId]
  );
  return rows[0] ?? null;
}

export async function createRate(pool, companyId, { fromCurrency, toCurrency, rate, effectiveDate, actor }) {
  const { rows } = await pool.query(
    `INSERT INTO core.exchange_rate
       (company_id, from_currency, to_currency, rate, effective_date, created_by, modified_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     RETURNING *`,
    [companyId, fromCurrency, toCurrency, rate, effectiveDate, actor]
  );
  return rows[0];
}

export async function updateRate(pool, companyId, rateId, { fromCurrency, toCurrency, rate, effectiveDate, actor }) {
  const { rows } = await pool.query(
    `UPDATE core.exchange_rate
     SET from_currency = $3, to_currency = $4, rate = $5,
         effective_date = $6, modified_by = $7, modified_at = NOW()
     WHERE company_id = $1 AND rate_id = $2
     RETURNING *`,
    [companyId, rateId, fromCurrency, toCurrency, rate, effectiveDate, actor]
  );
  return rows[0] ?? null;
}

export async function deleteRate(pool, companyId, rateId) {
  const { rows } = await pool.query(
    `DELETE FROM core.exchange_rate
     WHERE company_id = $1 AND rate_id = $2
     RETURNING rate_id`,
    [companyId, rateId]
  );
  return rows[0] ?? null;
}

export async function getLatestRate(pool, companyId, fromCurrency, toCurrency) {
  const { rows } = await pool.query(
    `SELECT rate_id, from_currency, to_currency, rate, effective_date
     FROM core.exchange_rate
     WHERE company_id = $1
       AND from_currency = $2
       AND to_currency = $3
       AND effective_date <= CURRENT_DATE
     ORDER BY effective_date DESC
     LIMIT 1`,
    [companyId, fromCurrency.toUpperCase(), toCurrency.toUpperCase()]
  );
  return rows[0] ?? null;
}
