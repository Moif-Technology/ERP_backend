-- Returns: return_no = document number; purchase_no = source purchase # or 0.
-- Allow duplicate purchase_no on RETURN rows (multiple returns vs same purchase).

ALTER TABLE ops.purchase_master DROP CONSTRAINT IF EXISTS uq_purchase_master_company_branch_purchase_no;

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_master_company_branch_purchase_no_purchase
  ON ops.purchase_master (company_id, branch_id, purchase_no)
  WHERE (
    transaction_type IS NULL
    OR TRIM(transaction_type) = ''
    OR UPPER(TRIM(transaction_type)) NOT IN ('RETURN', 'PURCHASE RETURN')
  )
  AND TRIM(COALESCE(purchase_no::text, '')) NOT IN ('', '0');
