/**
 * accounts.account_head_master — one chart per company (FK requires parent/child same company_id).
 * Branch-specific cash/card/sales mapping lives in accounts.accounts_parameter.
 */

function postingAllowedSql(alias = 'a') {
  return `(
      ${alias}.posting_allowed IS NULL
      OR TRIM(LOWER(${alias}.posting_allowed::text)) IN ('1', 't', 'true')
    )`;
}

export async function listAccountHeads(pool, companyId, { accountNoPrefix, postingOnly } = {}) {
  const params = [companyId];
  let sql = `
 SELECT a.account_id, a.account_no, a.account_head, a.account_type,
        a.parent_acc_id, a.posting_allowed, a.record_status
    FROM accounts.account_head_master a
    WHERE a.company_id = $1
    AND (
      a.record_status IS NULL
      OR TRIM(UPPER(a.record_status)) = 'ACTIVE'
    )`;
  if (postingOnly) {
    sql += ` AND ${postingAllowedSql('a')}`;
  }
  if (accountNoPrefix && String(accountNoPrefix).trim() !== '') {
    params.push(`${String(accountNoPrefix).trim()}%`);
    sql += ` AND a.account_no LIKE $${params.length}`;
  }
  sql += ' ORDER BY a.account_no ASC, a.account_id ASC';
  const { rows } = await pool.query(sql, params);
  return rows;
}

export async function findAccountHead(pool, companyId, accountId) {
  const { rows } = await pool.query(
    `SELECT a.account_id, a.account_no, a.account_head, a.account_type,
            a.parent_acc_id, a.posting_allowed, a.record_status
     FROM accounts.account_head_master a
     WHERE a.company_id = $1
       AND a.account_id = $2
       AND (
         a.record_status IS NULL
         OR TRIM(UPPER(a.record_status)) = 'ACTIVE'
       )
     LIMIT 1`,
    [companyId, accountId]
  );
  return rows[0] || null;
}

export async function getAccountTree(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT a.account_id, a.account_no, a.account_head, a.account_type,
            a.parent_acc_id, a.posting_allowed, a.record_status
     FROM accounts.account_head_master a
     WHERE a.company_id = $1
     AND (a.record_status IS NULL OR TRIM(UPPER(a.record_status)) = 'ACTIVE')
     ORDER BY a.account_no ASC, a.account_id ASC`,
    [companyId]
  );
  return rows;
}

export async function nextAccountId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(account_id), 22) + 1 AS n
     FROM accounts.account_head_master WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].n);
}

/** Next child account_no under a parent (e.g. 03-02 → 03-02-002, 03 → 03-05). */
export async function suggestNextAccountNo(db, companyId, parentAccId) {
  const parent = await findAccountHead(db, companyId, parentAccId);
  if (!parent) {
    const err = new Error('Parent account not found');
    err.status = 400;
    throw err;
  }
  const parentNo = String(parent.account_no || '').trim();
  if (!parentNo) {
    const err = new Error('Parent account has no account number');
    err.status = 400;
    throw err;
  }

  const prefix = `${parentNo}-`;
  const { rows } = await db.query(
    `SELECT account_no
     FROM accounts.account_head_master
     WHERE company_id = $1
       AND (parent_acc_id = $2 OR account_no LIKE $3)
       AND (record_status IS NULL OR TRIM(UPPER(record_status)) = 'ACTIVE')`,
    [companyId, parentAccId, `${prefix}%`],
  );

  let maxSeq = 0;
  let width = 0;
  for (const { account_no: no } of rows) {
    const s = String(no || '');
    if (!s.startsWith(prefix)) continue;
    const tail = s.slice(prefix.length);
    const segment = tail.split('-')[0];
    if (!/^\d+$/.test(segment)) continue;
    const n = parseInt(segment, 10);
    if (n > maxSeq) maxSeq = n;
    width = Math.max(width, segment.length);
  }

  const parentDashes = (parentNo.match(/-/g) || []).length;
  if (width === 0) width = parentDashes === 0 ? 2 : 3;

  return `${prefix}${String(maxSeq + 1).padStart(width, '0')}`;
}

export async function createAccountHead(client, row) {
  const hasCols = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'accounts' AND table_name = 'account_head_master' AND column_name = 'alias'`
  );
  const useAlias = hasCols.rows.length > 0;
  const cols = [
    'company_id', 'account_id', 'parent_acc_id', 'account_no', 'account_head',
    'account_type', 'posting_allowed', 'record_status', 'created_at', 'updated_at',
  ];
  const vals = [
    row.companyId, row.accountId, row.parentAccId || null,
    row.accountNo, row.accountHead, row.accountType || null,
    row.postingAllowed ? 1 : 0, 'ACTIVE', new Date(), new Date(),
  ];
  if (useAlias) {
    cols.push('alias');
    vals.push(row.accountHead);
  }
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
  await client.query(
    `INSERT INTO accounts.account_head_master (${cols.join(', ')}) VALUES (${placeholders})`,
    vals
  );
  return row.accountId;
}

export async function updateAccountHead(client, companyId, accountId, patch) {
  const sets = [];
  const params = [companyId, accountId];
  let idx = 3;
  if (patch.accountNo !== undefined) { sets.push(`account_no = $${idx++}`); params.push(patch.accountNo); }
  if (patch.accountHead !== undefined) {
    sets.push(`account_head = $${idx++}`);
    params.push(patch.accountHead);
    sets.push(`alias = $${idx++}`);
    params.push(patch.accountHead);
  }
  if (patch.accountType !== undefined) { sets.push(`account_type = $${idx++}`); params.push(patch.accountType); }
  if (patch.parentAccId !== undefined) { sets.push(`parent_acc_id = $${idx++}`); params.push(patch.parentAccId || null); }
  if (patch.postingAllowed !== undefined) { sets.push(`posting_allowed = $${idx++}`); params.push(patch.postingAllowed ? 1 : 0); }
  if (sets.length === 0) return false;
  sets.push('updated_at = NOW()');
  const { rowCount } = await client.query(
    `UPDATE accounts.account_head_master SET ${sets.join(', ')}
     WHERE company_id = $1 AND account_id = $2
       AND (record_status IS NULL OR TRIM(UPPER(record_status)) = 'ACTIVE')`,
    params
  );
  return rowCount > 0;
}

export async function softDeleteAccountHead(client, companyId, accountId) {
  const { rowCount } = await client.query(
    `UPDATE accounts.account_head_master
     SET record_status = 'INACTIVE', updated_at = NOW()
     WHERE company_id = $1 AND account_id = $2`,
    [companyId, accountId]
  );
  return rowCount > 0;
}

export async function accountHasChildren(pool, companyId, accountId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM accounts.account_head_master
     WHERE company_id = $1 AND parent_acc_id = $2
       AND (record_status IS NULL OR TRIM(UPPER(record_status)) = 'ACTIVE')
     LIMIT 1`,
    [companyId, accountId]
  );
  return rows.length > 0;
}

export async function accountHasVouchers(pool, companyId, accountId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM accounts.voucher_detail
     WHERE company_id = $1 AND account_id = $2
     LIMIT 1`,
    [companyId, accountId]
  );
  return rows.length > 0;
}
