/**
 * accounts.accounts_parameter — branch-wise (company + branch).
 */

export const PARAM_DEFAULT_CASH_LEDGER = 'DEFAULT_CASH_LEDGER';
export const PARAM_DEFAULT_CARD_LEDGER = 'DEFAULT_CARD_LEDGER';

export async function getParameterAccountId(pool, companyId, branchId, parameterName) {
  const { rows } = await pool.query(
    `SELECT account_id
     FROM accounts.accounts_parameter
     WHERE company_id = $1 AND branch_id = $2 AND parameter_name = $3
     LIMIT 1`,
    [companyId, branchId, parameterName]
  );
  const id = rows[0]?.account_id;
  if (id == null) return null;
  const n = Number(id);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
}

export async function getBranchAccountDefaults(pool, companyId, branchId) {
  const [cash, card] = await Promise.all([
    getParameterAccountId(pool, companyId, branchId, PARAM_DEFAULT_CASH_LEDGER),
    getParameterAccountId(pool, companyId, branchId, PARAM_DEFAULT_CARD_LEDGER),
  ]);
  return { defaultCashAccountId: cash, defaultCardAccountId: card };
}

export async function upsertParameter(client, { companyId, branchId, parameterName, accountId }) {
  await client.query(
    `INSERT INTO accounts.accounts_parameter (company_id, branch_id, parameter_name, account_id, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (company_id, branch_id, parameter_name)
     DO UPDATE SET account_id = EXCLUDED.account_id, updated_at = NOW()`,
    [companyId, branchId, parameterName, accountId]
  );
}
