-- Fix Module Isolation Issues
-- Purpose: Ensure modules only visible per software type
-- Deletes incorrect module configs that don't match software type restrictions
-- Run AFTER understanding current state with check-module-config.sql

BEGIN;

-- Backup current state
CREATE TEMP TABLE role_module_config_backup AS
SELECT * FROM core.role_module_config;

SELECT 'BACKUP: ' || COUNT(*)::TEXT || ' rows saved' as status
FROM role_module_config_backup;

-- ===========================================================================
-- RULE: Delete module configs that violate software type restrictions
-- ===========================================================================

-- RESTAURANT (type 1): Can ONLY have core + pos modules
DELETE FROM core.role_module_config rmc
WHERE EXISTS (
  SELECT 1 FROM core.role_master r
  LEFT JOIN backoffice.company_master c ON r.company_id = c.company_id
  WHERE r.company_id = rmc.company_id
    AND r.role_id = rmc.role_id
    AND COALESCE(c.software_type_id, 1) = 1
    AND rmc.module_code NOT IN ('core', 'pos', 'backoffice')
);

-- POS (type 2): Can ONLY have core + pos modules
DELETE FROM core.role_module_config rmc
WHERE EXISTS (
  SELECT 1 FROM core.role_master r
  LEFT JOIN backoffice.company_master c ON r.company_id = c.company_id
  WHERE r.company_id = rmc.company_id
    AND r.role_id = rmc.role_id
    AND COALESCE(c.software_type_id, 2) = 2
    AND rmc.module_code NOT IN ('core', 'pos', 'backoffice')
);

-- GARAGE (type 3): Can ONLY have core + garage modules
DELETE FROM core.role_module_config rmc
WHERE EXISTS (
  SELECT 1 FROM core.role_master r
  LEFT JOIN backoffice.company_master c ON r.company_id = c.company_id
  WHERE r.company_id = rmc.company_id
    AND r.role_id = rmc.role_id
    AND c.software_type_id = 3
    AND rmc.module_code NOT IN ('core', 'garage', 'backoffice')
);

-- HR (type 4): Can ONLY have core + hr modules
DELETE FROM core.role_module_config rmc
WHERE EXISTS (
  SELECT 1 FROM core.role_master r
  LEFT JOIN backoffice.company_master c ON r.company_id = c.company_id
  WHERE r.company_id = rmc.company_id
    AND r.role_id = rmc.role_id
    AND c.software_type_id = 4
    AND rmc.module_code NOT IN ('core', 'hr')
);

-- CRM (type 5): Can ONLY have core + crm modules
DELETE FROM core.role_module_config rmc
WHERE EXISTS (
  SELECT 1 FROM core.role_master r
  LEFT JOIN backoffice.company_master c ON r.company_id = c.company_id
  WHERE r.company_id = rmc.company_id
    AND r.role_id = rmc.role_id
    AND c.software_type_id = 5
    AND rmc.module_code NOT IN ('core', 'crm')
);

-- ERP (type 6): Can have core + backoffice (+ optionally others by plan)
DELETE FROM core.role_module_config rmc
WHERE EXISTS (
  SELECT 1 FROM core.role_master r
  LEFT JOIN backoffice.company_master c ON r.company_id = c.company_id
  WHERE r.company_id = rmc.company_id
    AND r.role_id = rmc.role_id
    AND COALESCE(c.software_type_id, 6) = 6
    AND rmc.module_code NOT IN ('core', 'backoffice', 'accounts', 'hr', 'crm', 'garage', 'van', 'service')
);

-- SALON (type 8): Can ONLY have core + pos modules
DELETE FROM core.role_module_config rmc
WHERE EXISTS (
  SELECT 1 FROM core.role_master r
  LEFT JOIN backoffice.company_master c ON r.company_id = c.company_id
  WHERE r.company_id = rmc.company_id
    AND r.role_id = rmc.role_id
    AND c.software_type_id = 8
    AND rmc.module_code NOT IN ('core', 'pos')
);

SELECT 'CLEANUP COMPLETE' as status;

-- ===========================================================================
-- VERIFY: Show what was deleted
-- ===========================================================================

SELECT
  'DELETED ROWS: ' || (
    SELECT COUNT(*) FROM role_module_config_backup
    EXCEPT
    SELECT COUNT(*) FROM core.role_module_config
  )::TEXT as status;

SELECT '' as spacer;
SELECT '=== REMAINING MODULE CONFIGS (Should now be clean) ===' as section;

SELECT
  c.company_id,
  c.company_name,
  COALESCE(st.software_code, 'UNKNOWN') as software_type,
  r.role_id,
  r.role_name,
  rmc.module_code,
  (SELECT COUNT(*) FROM jsonb_each(rmc.feature_config) WHERE value::boolean = TRUE)::TEXT as enabled_features
FROM backoffice.company_master c
LEFT JOIN core.software_type_master st ON c.software_type_id = st.software_type_id
LEFT JOIN core.role_master r ON c.company_id = r.company_id
LEFT JOIN core.role_module_config rmc ON r.company_id = rmc.company_id AND r.role_id = rmc.role_id
WHERE rmc.module_code IS NOT NULL
ORDER BY c.company_id, r.role_id, rmc.module_code;

COMMIT;
