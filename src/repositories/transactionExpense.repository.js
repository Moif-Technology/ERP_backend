/**
 * accounts.transaction_expense_detail — cash account head expense line on sales.
 * Mirrors VB TransactionExpenseTable: one row per sale with the cash ledger + net amount.
 */

export async function nextTransactionExpenseId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(transaction_expense_id), 0) + 1 AS n
     FROM accounts.transaction_expense_detail WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].n);
}

export async function deleteByTransactionMaster(client, companyId, transactionMasterId, transactionType) {
  await client.query(
    `DELETE FROM accounts.transaction_expense_detail
     WHERE company_id = $1 AND transaction_master_id = $2 AND transaction_type = $3`,
    [companyId, transactionMasterId, transactionType],
  );
}

export async function insertTransactionExpenseDetail(client, row) {
  await client.query(
    `INSERT INTO accounts.transaction_expense_detail (
       company_id, branch_id, transaction_expense_id, transaction_master_id,
       ledger_id, description, reference_no, transaction_date,
       foreign_currency_id, foreign_currency_rate, foreign_amount,
       amount, transaction_type, expense_type, server_status, tax_rate,
       created_at, created_by, modified_at, modified_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),0,0,0,$8,$9,$10,'PENDING',$11,NOW(),$12,NOW(),$12)`,
    [
      row.companyId,
      row.branchId,
      row.transactionExpenseId,
      row.transactionMasterId,
      row.ledgerId,
      row.description || 'SALES',
      row.referenceNo || '',
      row.amount,
      row.transactionType || 'SALES',
      row.expenseType || 'CASH SALES',
      row.taxRate || 0,
      row.createdBy,
    ],
  );
}
