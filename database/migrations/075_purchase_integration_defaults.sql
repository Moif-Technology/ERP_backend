-- Purchase integration defaults: DR ledgers + input tax per branch.
-- Runtime: accountsParameter.repository ensurePurchaseLedgerDefaults() also applies this idempotently.

DO $$
DECLARE
  v_company_id bigint := 1;
  v_branch_id  bigint;
  v_purchase_dr bigint;
  v_input_tax   bigint;
BEGIN
  SELECT account_id INTO v_purchase_dr
  FROM accounts.account_head_master
  WHERE company_id = v_company_id AND account_no = '12-001' AND posting_allowed = 1
  LIMIT 1;

  IF v_purchase_dr IS NULL THEN
    SELECT COALESCE(MAX(account_id), 22) + 1 INTO v_purchase_dr
    FROM accounts.account_head_master WHERE company_id = v_company_id;

    INSERT INTO accounts.account_head_master (
      company_id, account_id, parent_acc_id, account_no, account_head, alias,
      account_type, group_type, level_no, display_order, account_balance_type,
      opening_balance, account_balance, posting_allowed, station_id,
      cr_on, cr_by, mod_on, mod_by, nature_of_trns_id, vat_group_id, record_status,
      created_at, updated_at
    ) VALUES (
      v_company_id, v_purchase_dr, 12, '12-001', 'PURCHASE ACCOUNT', 'PURCHASE ACCOUNT',
      'PL', '', 2, 1, 'DR', 0, 0, 1, 10,
      NOW(), 'migration-075', NOW(), 'migration-075', 0, 0, 'ACTIVE', NOW(), NOW()
    );
  END IF;

  SELECT account_id INTO v_input_tax
  FROM accounts.account_head_master
  WHERE company_id = v_company_id AND account_no = '04-02-001' AND posting_allowed = 1
  LIMIT 1;

  IF v_input_tax IS NULL THEN
    SELECT COALESCE(MAX(account_id), 22) + 1 INTO v_input_tax
    FROM accounts.account_head_master WHERE company_id = v_company_id;

    INSERT INTO accounts.account_head_master (
      company_id, account_id, parent_acc_id, account_no, account_head, alias,
      account_type, group_type, level_no, display_order, account_balance_type,
      opening_balance, account_balance, posting_allowed, station_id,
      cr_on, cr_by, mod_on, mod_by, nature_of_trns_id, vat_group_id, record_status,
      created_at, updated_at
    ) VALUES (
      v_company_id, v_input_tax, 19, '04-02-001', 'INPUT VAT 5%', 'INPUT VAT 5%',
      'PL', '', 3, 1, 'DR', 0, 0, 1, 10,
      NOW(), 'migration-075', NOW(), 'migration-075', 0, 0, 'ACTIVE', NOW(), NOW()
    );
  END IF;

  FOR v_branch_id IN
    SELECT branch_id FROM core.branch_master WHERE company_id = v_company_id
  LOOP
    INSERT INTO accounts.accounts_parameter (
      company_id, branch_id, parameter_name, account_id, string_value, updated_at
    ) VALUES
      (v_company_id, v_branch_id, 'PurchaseEntryDRLedgerCash',     v_purchase_dr, 'PURCHASE ACCOUNT', NOW()),
      (v_company_id, v_branch_id, 'PurchaseEntryDRLedgerCredit',   v_purchase_dr, 'PURCHASE ACCOUNT', NOW()),
      (v_company_id, v_branch_id, 'PurchaseEntryDRLedgerOverseas', v_purchase_dr, 'PURCHASE ACCOUNT', NOW()),
      (v_company_id, v_branch_id, 'PurchaseEntryDRLedgerExempted', v_purchase_dr, 'PURCHASE ACCOUNT', NOW()),
      (v_company_id, v_branch_id, 'InputTax5%',                    v_input_tax,   'INPUT VAT 5%',     NOW())
    ON CONFLICT (company_id, branch_id, parameter_name)
    DO UPDATE SET
      account_id = COALESCE(accounts.accounts_parameter.account_id, EXCLUDED.account_id),
      string_value = COALESCE(accounts.accounts_parameter.string_value, EXCLUDED.string_value),
      updated_at = NOW()
    WHERE accounts.accounts_parameter.account_id IS NULL;
  END LOOP;
END $$;
