-- =============================================================================
-- MOIFONE ERP — Standard VAT Nature Master (PostgreSQL)
-- =============================================================================
-- Edit v_company_id below (default 1).
--
-- SECTION A — safe upsert (no delete)
-- SECTION B — clear + insert (uncomment block)
--
-- Note: only inserts company_id, vat_nature_id, name, type, record_status.
--       Avoids created_by/modified_by (your DB may use BIGINT for those columns).
-- =============================================================================


-- =============================================================================
-- SECTION A — SAFE UPSERT
-- =============================================================================

DO $$
DECLARE
  v_company_id bigint := 1;          -- <<< EDIT company_id
BEGIN
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
  ) AS d(vat_nature_id, vat_nature_name, vat_nature_type)
  ON CONFLICT (company_id, vat_nature_id)
  DO UPDATE SET
    vat_nature_name = EXCLUDED.vat_nature_name,
    vat_nature_type = EXCLUDED.vat_nature_type,
    record_status   = 'ACTIVE';

  RAISE NOTICE 'VAT nature upsert done for company_id=% (10 rows)', v_company_id;
END $$;


-- =============================================================================
-- SECTION B — CLEAR + INSERT (uncomment to run)
-- =============================================================================

/*
BEGIN;

DO $$
DECLARE
  v_company_id bigint := 1;
BEGIN
  DELETE FROM accounts.vat_nature_master WHERE company_id = v_company_id;

  INSERT INTO accounts.vat_nature_master (
    company_id, vat_nature_id, vat_nature_name, vat_nature_type, record_status
  )
  SELECT v_company_id, d.vat_nature_id, d.vat_nature_name, d.vat_nature_type, 'ACTIVE'
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
END $$;

COMMIT;
*/


-- =============================================================================
-- VERIFY
-- =============================================================================

SELECT vat_nature_id, vat_nature_name, vat_nature_type, record_status
FROM accounts.vat_nature_master
WHERE company_id = 1
ORDER BY vat_nature_id;

SELECT COUNT(*) AS total_rows
FROM accounts.vat_nature_master
WHERE company_id = 1;
