-- =============================================================================
-- CLEAR + INSERT standard VAT nature (PostgreSQL)
-- =============================================================================
-- IF YOU SEE: "current transaction is aborted" — run this first in Query Tool:
--   ROLLBACK;
-- Then run STEP 1 below, then STEP 2 separately.
--
-- Edit v_company_id in STEP 1 (default 1).
-- =============================================================================


-- STEP 1 — Clear + insert (run this block alone)
DO $$
DECLARE
  v_company_id bigint := 1;          -- <<< EDIT company_id
BEGIN
  DELETE FROM accounts.vat_nature_master
  WHERE company_id = v_company_id;

  INSERT INTO accounts.vat_nature_master (
    company_id, vat_nature_id, vat_nature_name, vat_nature_type, record_status
  )
  SELECT
    v_company_id,
    d.vat_nature_id,
    d.vat_nature_name,
    d.vat_nature_type,
    'ACTIVE'
  FROM (
    VALUES
      ( 1::bigint, 'Domestic Taxable Purchase',    'Purchase'),
      ( 2,         'Domestic NonTaxable Purchase', 'Purchase'),
      ( 3,         'Domestic Taxable Sale',        'Sales'),
      ( 4,         'Domestic NonTaxable Sale',     'Sales'),
      ( 5,         'Input Vat',                    'VatIN'),
      ( 6,         'OutPut Vat',                   'VatOUT'),
      ( 7,         'Discount Vat IN',              'VatINDiscount'),
      ( 8,         'Discount Vat OUT',             'VatOUTDiscount'),
      ( 9,         'Input Vat Expenses',           'VatIN'),
      (10,         'OutPut Vat Income',            'VatOUT')
  ) AS d(vat_nature_id, vat_nature_name, vat_nature_type);

  RAISE NOTICE 'Inserted 10 VAT nature rows for company_id=%', v_company_id;
END $$;


-- STEP 2 — Verify (run after STEP 1 succeeds)
SELECT vat_nature_id, vat_nature_name, vat_nature_type
FROM accounts.vat_nature_master
WHERE company_id = 1          -- <<< same company_id
ORDER BY vat_nature_id;
