-- Separate zero-rated / exempt purchase DR ledger (12-002) from taxable purchase DR (12-001).

DO $$
DECLARE
  v_company_id bigint := 1;
  v_branch_id  bigint;
  v_purchase_dr bigint;
  v_purchase_exempt_dr bigint;
BEGIN
  SELECT account_id INTO v_purchase_dr
  FROM accounts.account_head_master
  WHERE company_id = v_company_id AND account_no IN ('12-001', '12-01') AND posting_allowed = 1
  ORDER BY CASE WHEN account_no = '12-001' THEN 0 ELSE 1 END
  LIMIT 1;

  SELECT account_id INTO v_purchase_exempt_dr
  FROM accounts.account_head_master
  WHERE company_id = v_company_id AND account_no IN ('12-002', '12-02') AND posting_allowed = 1
  ORDER BY CASE WHEN account_no = '12-002' THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_purchase_exempt_dr IS NULL THEN
    SELECT COALESCE(MAX(account_id), 22) + 1 INTO v_purchase_exempt_dr
    FROM accounts.account_head_master WHERE company_id = v_company_id;

    INSERT INTO accounts.account_head_master (
      company_id, account_id, parent_acc_id, account_no, account_head, alias,
      account_type, group_type, level_no, display_order, account_balance_type,
      opening_balance, account_balance, posting_allowed, station_id,
      cr_on, cr_by, mod_on, mod_by, nature_of_trns_id, vat_group_id, record_status,
      created_at, updated_at
    ) VALUES (
      v_company_id, v_purchase_exempt_dr, 12, '12-002', 'PURCHASE EXEMPT (ZERO RATED)', 'PURCHASE EXEMPT',
      'PL', '', 2, 2, 'DR', 0, 0, 1, 10,
      NOW(), 'migration-076', NOW(), 'migration-076', 0, 0, 'ACTIVE', NOW(), NOW()
    )
    ON CONFLICT (company_id, account_id) DO NOTHING;
  END IF;

  FOR v_branch_id IN
    SELECT branch_id FROM core.branch_master WHERE company_id = v_company_id
  LOOP
    INSERT INTO accounts.accounts_parameter (
      company_id, branch_id, parameter_name, account_id, string_value, updated_at
    ) VALUES (
      v_company_id, v_branch_id, 'PurchaseEntryDRLedgerExempted', v_purchase_exempt_dr,
      'PURCHASE EXEMPT (ZERO RATED)', NOW()
    )
    ON CONFLICT (company_id, branch_id, parameter_name)
    DO UPDATE SET
      account_id = CASE
        WHEN accounts.accounts_parameter.account_id IS NULL THEN EXCLUDED.account_id
        WHEN v_purchase_dr IS NOT NULL AND accounts.accounts_parameter.account_id = v_purchase_dr
          THEN EXCLUDED.account_id
        ELSE accounts.accounts_parameter.account_id
      END,
      string_value = CASE
        WHEN v_purchase_dr IS NOT NULL AND accounts.accounts_parameter.account_id = v_purchase_dr
          THEN EXCLUDED.string_value
        ELSE COALESCE(accounts.accounts_parameter.string_value, EXCLUDED.string_value)
      END,
      updated_at = NOW();
  END LOOP;
END $$;
