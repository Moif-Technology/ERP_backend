-- Purchase return: link to source purchase + integration defaults.

ALTER TABLE ops.purchase_master
  ADD COLUMN IF NOT EXISTS source_purchase_id BIGINT NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_master_source_purchase
  ON ops.purchase_master (company_id, source_purchase_id)
  WHERE source_purchase_id IS NOT NULL;

DO $$
DECLARE
  v_company_id bigint := 1;
  v_branch_id  bigint;
  v_purchase_cr bigint;
  v_voucher_type_id bigint;
BEGIN
  SELECT account_id INTO v_purchase_cr
  FROM accounts.account_head_master
  WHERE company_id = v_company_id AND account_no IN ('12-001', '12-01') AND posting_allowed = 1
  ORDER BY CASE WHEN account_no = '12-001' THEN 0 ELSE 1 END
  LIMIT 1;

  SELECT COALESCE(MAX(voucher_type_id), 0) + 1 INTO v_voucher_type_id
  FROM accounts.voucher_type_master WHERE company_id = v_company_id;

  INSERT INTO accounts.voucher_type_master (
    company_id, voucher_type_id, voucher_type_code, voucher_name, voucher_name_alias,
    voucher_prefix, numbering_method, record_status, created_at, created_by, modified_at, modified_by
  )
  SELECT v_company_id, v_voucher_type_id, 'PRT', 'Purchase Return', 'Purchase Return', 'PRT-',
         'AUTO', 'ACTIVE', NOW(), 'migration-077', NOW(), 'migration-077'
  WHERE NOT EXISTS (
    SELECT 1 FROM accounts.voucher_type_master
    WHERE company_id = v_company_id
      AND (voucher_type_code = 'PRT' OR voucher_name ILIKE '%Purchase Return%')
  );

  IF v_purchase_cr IS NOT NULL THEN
    FOR v_branch_id IN
      SELECT branch_id FROM core.branch_master WHERE company_id = v_company_id
    LOOP
      INSERT INTO accounts.accounts_parameter (
        company_id, branch_id, parameter_name, account_id, string_value, updated_at
      ) VALUES
        (v_company_id, v_branch_id, 'PurchaseReturnCRLedgerCash',     v_purchase_cr, 'PURCHASE ACCOUNT', NOW()),
        (v_company_id, v_branch_id, 'PurchaseReturnCRLedgerCredit',   v_purchase_cr, 'PURCHASE ACCOUNT', NOW()),
        (v_company_id, v_branch_id, 'PurchaseReturnCRLedgerOverseas', v_purchase_cr, 'PURCHASE ACCOUNT', NOW()),
        (v_company_id, v_branch_id, 'PurchaseReturnCRLedgerExempted', v_purchase_cr, 'PURCHASE ACCOUNT', NOW()),
        (v_company_id, v_branch_id, 'PurchaseReturnVoucherName',
          (SELECT voucher_type_id FROM accounts.voucher_type_master
           WHERE company_id = v_company_id AND voucher_type_code = 'PRT' LIMIT 1),
          'Purchase Return', NOW())
      ON CONFLICT (company_id, branch_id, parameter_name)
      DO UPDATE SET
        account_id = COALESCE(accounts.accounts_parameter.account_id, EXCLUDED.account_id),
        string_value = COALESCE(accounts.accounts_parameter.string_value, EXCLUDED.string_value),
        updated_at = NOW()
      WHERE accounts.accounts_parameter.account_id IS NULL;
    END LOOP;
  END IF;
END $$;
