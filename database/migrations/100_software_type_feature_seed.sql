-- 100_software_type_feature_seed.sql
-- Activates the dormant software-type entitlement layer (core.software_type_feature
-- existed since an earlier migration but was never populated — resolveSoftwareTypeScope()
-- in entitlement.service.js silently no-ops on an empty table, so every company has
-- been running on plan-only gating regardless of the software type chosen at signup).
--
-- Rule implemented (see entitlement.service.js applySoftwareTypeScope):
--   - is_granted = TRUE  -> feature always reachable for that software type, REGARDLESS
--                           of plan tier (fixes "bought POS on basic plan, POS pack is
--                           actually disabled" — confirmed live for company_id=2/test2).
--   - is_granted = FALSE -> feature reachable only if the company's plan ALSO enables it.
--
-- IMPORTANT: 'allowed' (any row present, granted or not) is set to EVERY pack for
-- EVERY software type. applySoftwareTypeScope() only ever narrows to what's in the
-- allowed set — a first version of this migration scoped 'allowed' to a per-type
-- subset and it silently stripped hr/garage access from pro/custom-plan companies
-- that already had it via plan_feature (verified live against company_id=3/4).
-- Never repeat that: allowed must always be the full pack list, so this layer can only
-- ADD access (via is_granted=TRUE) on top of the plan, never SUBTRACT what the plan
-- already grants.
--
-- Run on both local and production DB.

-- RESTAURANT (software_type_id = 1): force-grant core + pos; every other pack reachable if plan allows it
INSERT INTO core.software_type_feature (software_type_id, feature_code, is_granted, created_at)
SELECT 1, feature_code, TRUE, NOW() FROM core.feature_master WHERE pack_code IN ('core','pos') AND is_active = TRUE
UNION ALL
SELECT 1, feature_code, FALSE, NOW() FROM core.feature_master WHERE pack_code IN ('backoffice','accounts','crm','van','hr','garage') AND is_active = TRUE
ON CONFLICT (software_type_id, feature_code) DO UPDATE SET is_granted = EXCLUDED.is_granted;

-- POS (software_type_id = 2): force-grant core + pos; every other pack reachable if plan allows it
INSERT INTO core.software_type_feature (software_type_id, feature_code, is_granted, created_at)
SELECT 2, feature_code, TRUE, NOW() FROM core.feature_master WHERE pack_code IN ('core','pos') AND is_active = TRUE
UNION ALL
SELECT 2, feature_code, FALSE, NOW() FROM core.feature_master WHERE pack_code IN ('backoffice','accounts','crm','van','hr','garage') AND is_active = TRUE
ON CONFLICT (software_type_id, feature_code) DO UPDATE SET is_granted = EXCLUDED.is_granted;

-- GARAGE (software_type_id = 3): force-grant core + garage; every other pack reachable if plan allows it
INSERT INTO core.software_type_feature (software_type_id, feature_code, is_granted, created_at)
SELECT 3, feature_code, TRUE, NOW() FROM core.feature_master WHERE pack_code IN ('core','garage') AND is_active = TRUE
UNION ALL
SELECT 3, feature_code, FALSE, NOW() FROM core.feature_master WHERE pack_code IN ('backoffice','accounts','crm','van','pos','hr') AND is_active = TRUE
ON CONFLICT (software_type_id, feature_code) DO UPDATE SET is_granted = EXCLUDED.is_granted;

-- HR (software_type_id = 4): force-grant core + hr; every other pack reachable if plan allows it
INSERT INTO core.software_type_feature (software_type_id, feature_code, is_granted, created_at)
SELECT 4, feature_code, TRUE, NOW() FROM core.feature_master WHERE pack_code IN ('core','hr') AND is_active = TRUE
UNION ALL
SELECT 4, feature_code, FALSE, NOW() FROM core.feature_master WHERE pack_code IN ('backoffice','accounts','crm','van','pos','garage') AND is_active = TRUE
ON CONFLICT (software_type_id, feature_code) DO UPDATE SET is_granted = EXCLUDED.is_granted;

-- CRM (software_type_id = 5): force-grant core + crm; every other pack reachable if plan allows it
INSERT INTO core.software_type_feature (software_type_id, feature_code, is_granted, created_at)
SELECT 5, feature_code, TRUE, NOW() FROM core.feature_master WHERE pack_code IN ('core','crm') AND is_active = TRUE
UNION ALL
SELECT 5, feature_code, FALSE, NOW() FROM core.feature_master WHERE pack_code IN ('backoffice','accounts','van','pos','garage','hr') AND is_active = TRUE
ON CONFLICT (software_type_id, feature_code) DO UPDATE SET is_granted = EXCLUDED.is_granted;

-- ERP / Backoffice-only (software_type_id = 6): force-grant core only; every other pack reachable if plan allows it
INSERT INTO core.software_type_feature (software_type_id, feature_code, is_granted, created_at)
SELECT 6, feature_code, TRUE, NOW() FROM core.feature_master WHERE pack_code = 'core' AND is_active = TRUE
UNION ALL
SELECT 6, feature_code, FALSE, NOW() FROM core.feature_master WHERE pack_code IN ('backoffice','accounts','crm','van','pos','garage','hr') AND is_active = TRUE
ON CONFLICT (software_type_id, feature_code) DO UPDATE SET is_granted = EXCLUDED.is_granted;
