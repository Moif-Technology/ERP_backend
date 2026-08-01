-- 111_accounts_salon_laundry_features.sql
-- Add feature catalog entries for Accounts, Salon, and Laundry modules
-- These are top-level toggles for entire feature packs

BEGIN;

-- Insert core features for accounts, salon, and laundry
INSERT INTO core.feature_master
  (feature_code, feature_name, pack_code, parent_feature_code, feature_type, sort_order, is_active)
VALUES
  ('accounts',           'Accounts Module',            'accounts', NULL, 'feature', 1, TRUE),
  ('salon',              'Salon POS Module',           'pos', NULL, 'feature', 240, TRUE),
  ('laundry',            'Laundry POS Module',         'pos', NULL, 'feature', 241, TRUE)
ON CONFLICT (feature_code) DO UPDATE SET
  feature_name        = EXCLUDED.feature_name,
  pack_code           = EXCLUDED.pack_code,
  parent_feature_code = EXCLUDED.parent_feature_code,
  feature_type        = EXCLUDED.feature_type,
  sort_order          = EXCLUDED.sort_order,
  is_active           = EXCLUDED.is_active,
  updated_at          = NOW();

-- Add to plan_feature for all standard plans
INSERT INTO core.plan_feature (plan_code, feature_code, is_enabled)
SELECT p.plan_code, f.feature_code, TRUE
FROM core.plan_master p
CROSS JOIN core.feature_master f
WHERE f.feature_code IN ('accounts', 'salon', 'laundry')
  AND p.plan_code IN ('basic', 'standard', 'pro', 'custom')
ON CONFLICT (plan_code, feature_code) DO NOTHING;

-- Add to software_type_feature
-- Accounts: all software types can use it
-- Salon: only SALON software type (8)
-- Laundry: only SALON software type (8) - both variants use same type
INSERT INTO core.software_type_feature (software_type_id, feature_code, is_granted, created_at)
SELECT stm.software_type_id, f.feature_code,
       CASE
         WHEN f.feature_code = 'accounts' THEN TRUE
         WHEN f.feature_code IN ('salon', 'laundry') AND stm.software_code = 'SALON' THEN TRUE
         ELSE FALSE
       END,
       NOW()
FROM core.software_type_master stm
CROSS JOIN core.feature_master f
WHERE f.feature_code IN ('accounts', 'salon', 'laundry')
ON CONFLICT (software_type_id, feature_code)
DO UPDATE SET is_granted = EXCLUDED.is_granted;

-- Add permissions for these features
INSERT INTO core.permission_master
  (permission_code, feature_code, action_code, permission_name, is_active, sort_order)
SELECT f.feature_code || '.' || a.action_code,
       f.feature_code,
       a.action_code,
       f.feature_name || ' - ' || INITCAP(a.action_code),
       TRUE,
       f.sort_order * 10 + a.sort_offset
FROM core.feature_master f
CROSS JOIN (VALUES ('view',1),('create',2),('edit',3),('delete',4)) AS a(action_code, sort_offset)
WHERE f.feature_code IN ('accounts', 'salon', 'laundry')
  AND f.feature_type = 'feature'
ON CONFLICT (permission_code) DO NOTHING;

-- Grant all permissions for these features to super admin (role_id = 1)
INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
SELECT rm.company_id, rm.role_id, pm.permission_code, TRUE
FROM core.role_master rm
CROSS JOIN core.permission_master pm
WHERE rm.role_id = 1
  AND pm.feature_code IN ('accounts', 'salon', 'laundry')
  AND pm.is_active = TRUE
  AND rm.record_status = 'ACTIVE'
ON CONFLICT (company_id, role_id, permission_code)
DO UPDATE SET is_allowed = TRUE, updated_at = NOW();

COMMIT;
