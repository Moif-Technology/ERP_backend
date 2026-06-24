-- Sales return: link to source sale + integration defaults (mirror purchase return 077–079).

CREATE INDEX IF NOT EXISTS idx_sales_master_return_sales_id
  ON ops.sales_master (company_id, return_sales_id)
  WHERE return_sales_id IS NOT NULL;

-- Allow negative amounts on RETURN rows (mirror 078 purchase return).
ALTER TABLE ops.sales_master DROP CONSTRAINT IF EXISTS ck_sales_master_amount_nonneg;
ALTER TABLE ops.sales_master ADD CONSTRAINT ck_sales_master_amount_nonneg
  CHECK (
    amount >= 0
    OR UPPER(COALESCE(TRIM(transaction_type), '')) = 'RETURN'
  );

ALTER TABLE ops.sales_master DROP CONSTRAINT IF EXISTS ck_sales_master_subtotal_nonneg;
ALTER TABLE ops.sales_master ADD CONSTRAINT ck_sales_master_subtotal_nonneg
  CHECK (
    subtotal_amount >= 0
    OR UPPER(COALESCE(TRIM(transaction_type), '')) = 'RETURN'
  );

ALTER TABLE ops.sales_master DROP CONSTRAINT IF EXISTS ck_sales_master_outstanding_nonneg;
ALTER TABLE ops.sales_master ADD CONSTRAINT ck_sales_master_outstanding_nonneg
  CHECK (
    outstanding_balance >= 0
    OR UPPER(COALESCE(TRIM(transaction_type), '')) = 'RETURN'
  );

ALTER TABLE ops.sales_master DROP CONSTRAINT IF EXISTS ck_sales_master_discount_nonneg;
ALTER TABLE ops.sales_master ADD CONSTRAINT ck_sales_master_discount_nonneg
  CHECK (
    discount_amount >= 0
    OR UPPER(COALESCE(TRIM(transaction_type), '')) = 'RETURN'
  );

-- Multiple returns may reference the same source bill_no.
DROP INDEX IF EXISTS uq_ops_sales_master_company_branch_bill_no;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_sales_master_company_branch_bill_no_sale
  ON ops.sales_master (company_id, branch_id, bill_no)
  WHERE (
    transaction_type IS NULL
    OR TRIM(transaction_type) = ''
    OR UPPER(TRIM(transaction_type)) NOT IN ('RETURN', 'SALES RETURN')
  )
  AND bill_no IS NOT NULL
  AND bill_no <> 0;

DO $$
DECLARE
  v_company_id bigint := 1;
  v_branch_id  bigint;
  v_sales_cr bigint;
  v_voucher_type_id bigint;
BEGIN
  SELECT account_id INTO v_sales_cr
  FROM accounts.account_head_master
  WHERE company_id = v_company_id AND account_no IN ('11-001', '11-01') AND posting_allowed = 1
  ORDER BY CASE WHEN account_no = '11-001' THEN 0 ELSE 1 END
  LIMIT 1;

  SELECT COALESCE(MAX(voucher_type_id), 0) + 1 INTO v_voucher_type_id
  FROM accounts.voucher_type_master WHERE company_id = v_company_id;

  INSERT INTO accounts.voucher_type_master (
    company_id, voucher_type_id, voucher_type_code, voucher_name, voucher_name_alias,
    voucher_prefix, numbering_method, record_status, created_at, created_by, modified_at, modified_by
  )
  SELECT v_company_id, v_voucher_type_id, 'SRT', 'Sales Return', 'Sales Return', 'SRT-',
         'AUTO', 'ACTIVE', NOW(), 'migration-088', NOW(), 'migration-088'
  WHERE NOT EXISTS (
    SELECT 1 FROM accounts.voucher_type_master
    WHERE company_id = v_company_id
      AND (voucher_type_code = 'SRT' OR voucher_name ILIKE '%Sales Return%')
  );

  IF v_sales_cr IS NOT NULL THEN
    FOR v_branch_id IN
      SELECT branch_id FROM core.branch_master WHERE company_id = v_company_id
    LOOP
      INSERT INTO accounts.accounts_parameter (
        company_id, branch_id, parameter_name, account_id, string_value, updated_at
      ) VALUES
        (v_company_id, v_branch_id, 'SalesReturnCRLedgerCash', v_sales_cr, 'SALES ACCOUNT', NOW()),
        (v_company_id, v_branch_id, 'SalesReturnCRLedgerCredit', v_sales_cr, 'SALES ACCOUNT', NOW()),
        (v_company_id, v_branch_id, 'SalesReturnCRLedgerCreditCard', v_sales_cr, 'SALES ACCOUNT', NOW()),
        (v_company_id, v_branch_id, 'SalesReturnCRLedgerOverseas', v_sales_cr, 'SALES ACCOUNT', NOW()),
        (v_company_id, v_branch_id, 'SalesReturnCRLedgerExempted', v_sales_cr, 'SALES ACCOUNT', NOW()),
        (v_company_id, v_branch_id, 'SalesReturnCRDiscountLedger', NULL, 'SALES RETURN DISCOUNT', NOW()),
        (v_company_id, v_branch_id, 'SalesReturnCRRoundingLedger', NULL, 'SALES RETURN ROUNDING', NOW()),
        (v_company_id, v_branch_id, 'SalesReturnVoucherName',
          (SELECT voucher_type_id FROM accounts.voucher_type_master
           WHERE company_id = v_company_id AND voucher_type_code = 'SRT' LIMIT 1),
          'Sales Return', NOW())
      ON CONFLICT (company_id, branch_id, parameter_name)
      DO UPDATE SET
        account_id = COALESCE(accounts.accounts_parameter.account_id, EXCLUDED.account_id),
        string_value = COALESCE(accounts.accounts_parameter.string_value, EXCLUDED.string_value),
        updated_at = NOW()
      WHERE accounts.accounts_parameter.account_id IS NULL;
    END LOOP;
  END IF;
END $$;
