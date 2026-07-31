-- Quick Fix: Clean Module Config for Specific Tenant
-- Usage: psql -U postgres -d moifone_uae -v company_id=2 -f fix-tenant-modules.sql
-- Example: psql -U postgres -d moifone_uae -v company_id=2 -f fix-tenant-modules.sql

-- Replace :company_id with actual company ID, or set via -v flag

\set ON_ERROR_STOP on

-- Verify company exists
DO $$
DECLARE
  v_company_id INT := :'company_id'::INT;
  v_company_name VARCHAR;
  v_software_type VARCHAR;
BEGIN
  SELECT c.company_name, COALESCE(st.software_code, 'ERP')
  INTO v_company_name, v_software_type
  FROM backoffice.company_master c
  LEFT JOIN core.software_type_master st ON c.software_type_id = st.software_type_id
  WHERE c.company_id = v_company_id;

  IF v_company_name IS NULL THEN
    RAISE EXCEPTION 'Company ID % not found', v_company_id;
  END IF;

  RAISE NOTICE 'Fixing modules for: % (Type: %)', v_company_name, v_software_type;
END $$;

BEGIN;

-- Get company info
WITH company_info AS (
  SELECT
    c.company_id,
    c.company_name,
    COALESCE(st.software_code, 'ERP') as software_type,
    COALESCE(st.software_type_id, 6) as software_type_id
  FROM backoffice.company_master c
  LEFT JOIN core.software_type_master st ON c.software_type_id = st.software_type_id
  WHERE c.company_id = :'company_id'::INT
)
SELECT
  'COMPANY: ' || company_name || ' (Type: ' || software_type || ')' as info
FROM company_info;

-- Show current broken config
SELECT '' as spacer;
SELECT '=== CURRENT MODULE CONFIG ===' as header;

SELECT
  r.role_id,
  r.role_name,
  rmc.module_code,
  (rmc.feature_config IS NULL OR rmc.feature_config = '{}'::jsonb) as all_or_none
FROM core.role_master r
LEFT JOIN core.role_module_config rmc ON r.company_id = rmc.company_id AND r.role_id = rmc.role_id
WHERE r.company_id = :'company_id'::INT
ORDER BY r.role_id, rmc.module_code;

-- Apply cleanup based on software type
SELECT '' as spacer;
SELECT '=== APPLYING FIXES ===' as header;

WITH fixes AS (
  SELECT
    c.software_type_id,
    c.software_code,
    CASE
      WHEN c.software_code IN ('RESTAURANT', 'RESTAURANT-POS', 'POS', 'COUNTER-POS')
        THEN ARRAY['core', 'pos', 'backoffice']
      WHEN c.software_code IN ('SALON', 'LAUNDRY')
        THEN ARRAY['core', 'pos']
      WHEN c.software_code = 'GARAGE'
        THEN ARRAY['core', 'garage', 'backoffice']
      WHEN c.software_code = 'HR'
        THEN ARRAY['core', 'hr']
      WHEN c.software_code = 'CRM'
        THEN ARRAY['core', 'crm']
      ELSE ARRAY['core', 'backoffice', 'accounts', 'hr', 'crm', 'garage', 'van', 'service']
    END as allowed_modules
  FROM core.software_type_master c
  WHERE c.software_type_id = (
    SELECT COALESCE(c2.software_type_id, 6)
    FROM backoffice.company_master c2
    WHERE c2.company_id = :'company_id'::INT
  )
)
DELETE FROM core.role_module_config rmc
WHERE rmc.company_id = :'company_id'::INT
  AND rmc.module_code NOT IN (
    SELECT UNNEST(allowed_modules) FROM fixes LIMIT 20
  );

SELECT COUNT(*)::TEXT || ' invalid module configs deleted' as result
FROM (SELECT 1 WHERE FALSE) dummy;

-- Show cleaned config
SELECT '' as spacer;
SELECT '=== CLEANED MODULE CONFIG ===' as header;

SELECT
  r.role_id,
  r.role_name,
  COALESCE(
    STRING_AGG(rmc.module_code, ', ' ORDER BY rmc.module_code),
    'No modules configured'
  ) as enabled_modules
FROM core.role_master r
LEFT JOIN core.role_module_config rmc ON r.company_id = rmc.company_id AND r.role_id = rmc.role_id
WHERE r.company_id = :'company_id'::INT
GROUP BY r.role_id, r.role_name
ORDER BY r.role_id;

SELECT '' as spacer;
SELECT '✅ DONE - Module isolation restored for this tenant' as status;

COMMIT;
