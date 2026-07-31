-- Diagnostic Script: Check Module Configuration per Tenant/Company
-- Usage: psql -U postgres -d moifone_uae -f check-module-config.sql

SELECT
  '=== COMPANIES & SOFTWARE TYPES ===' as section;

SELECT
  c.company_id,
  c.company_name,
  COALESCE(st.software_code, 'UNKNOWN') as software_type,
  st.software_type_id,
  c.plan_code,
  c.record_status
FROM backoffice.company_master c
LEFT JOIN core.software_type_master st ON c.software_type_id = st.software_type_id
ORDER BY c.company_id;

SELECT '' as spacer;
SELECT
  '=== ROLES PER COMPANY ===' as section;

SELECT
  c.company_id,
  c.company_name,
  r.role_id,
  r.role_name,
  COALESCE(r.software_type, 'NULL') as role_software_type,
  COUNT(rp.permission_code) as permission_count
FROM backoffice.company_master c
LEFT JOIN core.role_master r ON c.company_id = r.company_id
LEFT JOIN core.role_permission rp ON r.company_id = rp.company_id AND r.role_id = rp.role_id AND rp.is_allowed = TRUE
GROUP BY c.company_id, c.company_name, r.role_id, r.role_name, r.software_type
ORDER BY c.company_id, r.role_id;

SELECT '' as spacer;
SELECT
  '=== MODULE CONFIGURATION PER COMPANY/ROLE ===' as section;

SELECT
  c.company_id,
  c.company_name,
  r.role_id,
  r.role_name,
  rmc.module_code,
  rmc.feature_config,
  CASE
    WHEN rmc.feature_config IS NULL THEN 'All features enabled'
    WHEN rmc.feature_config = '{}'::jsonb THEN 'No features enabled'
    ELSE (SELECT COUNT(*)::TEXT || ' features enabled'
          FROM jsonb_each(rmc.feature_config)
          WHERE value::boolean = TRUE)
  END as status
FROM backoffice.company_master c
LEFT JOIN core.role_master r ON c.company_id = r.company_id
LEFT JOIN core.role_module_config rmc ON r.company_id = rmc.company_id AND r.role_id = rmc.role_id
WHERE rmc.module_code IS NOT NULL OR r.role_id IS NOT NULL
ORDER BY c.company_id, r.role_id, rmc.module_code;

SELECT '' as spacer;
SELECT
  '=== ENABLED FEATURES PER COMPANY ===' as section;

SELECT
  c.company_id,
  c.company_name,
  COUNT(DISTINCT pf.feature_code) as plan_features,
  STRING_AGG(DISTINCT pf.pack_code, ', ' ORDER BY pf.pack_code) as packs
FROM backoffice.company_master c
LEFT JOIN core.plan_feature pf ON c.plan_code = pf.plan_code AND pf.is_enabled = TRUE
GROUP BY c.company_id, c.company_name
ORDER BY c.company_id;

SELECT '' as spacer;
SELECT
  '=== SOFTWARE TYPE FEATURE GRANTS ===' as section;

SELECT
  st.software_code,
  st.software_type_id,
  COUNT(DISTINCT stf.feature_code) FILTER (WHERE stf.is_granted = TRUE) as granted_features,
  COUNT(DISTINCT stf.feature_code) FILTER (WHERE stf.is_granted = FALSE) as plan_gated_features,
  STRING_AGG(DISTINCT fm.pack_code, ', ' ORDER BY fm.pack_code) as packs
FROM core.software_type_master st
LEFT JOIN core.software_type_feature stf ON st.software_type_id = stf.software_type_id
LEFT JOIN core.feature_master fm ON stf.feature_code = fm.feature_code
GROUP BY st.software_type_id, st.software_code
ORDER BY st.software_type_id;

SELECT '' as spacer;
SELECT
  '=== ISSUE: Check if modules bleeding across ===' as section;

-- For each tenant, what modules should be visible based on software type + plan?
SELECT
  c.company_id,
  c.company_name,
  COALESCE(st.software_code, 'ERP') as software_type,
  c.plan_code,
  STRING_AGG(DISTINCT COALESCE(fm.pack_code, 'UNKNOWN'), ', ' ORDER BY COALESCE(fm.pack_code, 'UNKNOWN')) as expected_modules
FROM backoffice.company_master c
LEFT JOIN core.software_type_master st ON c.software_type_id = st.software_type_id
LEFT JOIN core.software_type_feature stf ON st.software_type_id = stf.software_type_id AND stf.is_granted = TRUE
LEFT JOIN core.feature_master fm ON stf.feature_code = fm.feature_code
GROUP BY c.company_id, c.company_name, st.software_code, c.plan_code
ORDER BY c.company_id;
