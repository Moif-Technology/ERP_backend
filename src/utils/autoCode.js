function quoteIdent(name) {
  const raw = String(name || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) {
    throw new Error(`Invalid SQL identifier: ${raw}`);
  }
  return `"${raw}"`;
}

function quoteTableName(tableName) {
  return String(tableName || '')
    .split('.')
    .map(quoteIdent)
    .join('.');
}

function normalizePrefix(prefix, fallback = 'AUTO') {
  const value = String(prefix || fallback)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return value || fallback;
}

function nextNumberFromCodes(codes, prefix) {
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-?(\\d+)$`, 'i');
  return codes.reduce((max, code) => {
    const match = String(code || '').trim().match(re);
    if (!match) return max;
    const n = Number(match[1]);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0) + 1;
}

export async function generateScopedAutoCode(
  client,
  {
    tableName,
    codeColumn,
    companyId,
    prefix = 'AUTO',
    padLength = 6,
    maxLength = 50,
  }
) {
  const company = Number(companyId);
  if (!Number.isFinite(company) || company < 1) {
    throw new Error('Invalid companyId for auto code generation');
  }

  const table = quoteTableName(tableName);
  const column = quoteIdent(codeColumn);
  const safePrefix = normalizePrefix(prefix);
  const safePad = Math.max(1, Number(padLength) || 6);
  const safeMax = Math.max(safePrefix.length + 2, Number(maxLength) || 50);

  await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
    `auto-code:${tableName}:${codeColumn}:${company}:${safePrefix}`,
  ]);

  const { rows } = await client.query(
    `SELECT ${column} AS code
     FROM ${table}
     WHERE company_id = $1
       AND ${column} ILIKE $2`,
    [company, `${safePrefix}%`]
  );

  const next = nextNumberFromCodes(rows.map((row) => row.code), safePrefix);
  const suffix = String(next).padStart(safePad, '0');
  const code = `${safePrefix}-${suffix}`;
  return code.slice(0, safeMax);
}
