-- Van Sales: features, permissions, and plan entitlements
-- Run on both local and production DB.

-- 1. Features
INSERT INTO core.feature_master
  (feature_code, feature_name, pack_code, parent_feature_code, feature_type, sort_order, is_active)
VALUES
  ('van',              'Van Sales',    'van', NULL,  'pack',    700, TRUE),
  ('van.sales',        'Sales',        'van', 'van', 'feature', 701, TRUE),
  ('van.customers',    'Customers',    'van', 'van', 'feature', 702, TRUE),
  ('van.products',     'Products',     'van', 'van', 'feature', 703, TRUE),
  ('van.dashboard',    'Dashboard',    'van', 'van', 'feature', 704, TRUE),
  ('van.day_summary',  'Day summary',  'van', 'van', 'feature', 705, TRUE)
ON CONFLICT (feature_code) DO UPDATE SET
  feature_name        = EXCLUDED.feature_name,
  pack_code           = EXCLUDED.pack_code,
  parent_feature_code = EXCLUDED.parent_feature_code,
  feature_type        = EXCLUDED.feature_type,
  sort_order          = EXCLUDED.sort_order,
  is_active           = EXCLUDED.is_active,
  updated_at          = NOW();

-- 2. Permissions
INSERT INTO core.permission_master
  (permission_code, feature_code, action_code, permission_name, is_active, sort_order)
VALUES
  ('van.sales.view',       'van.sales',       'view',   'Van Sales - View',       TRUE, 7011),
  ('van.sales.create',     'van.sales',       'create', 'Van Sales - Create',     TRUE, 7012),
  ('van.customers.view',   'van.customers',   'view',   'Van Customers - View',   TRUE, 7021),
  ('van.products.view',    'van.products',    'view',   'Van Products - View',    TRUE, 7031),
  ('van.dashboard.view',   'van.dashboard',   'view',   'Van Dashboard - View',   TRUE, 7041),
  ('van.day_summary.view', 'van.day_summary', 'view',   'Van Day Summary - View', TRUE, 7051)
ON CONFLICT (permission_code) DO UPDATE SET
  feature_code    = EXCLUDED.feature_code,
  action_code     = EXCLUDED.action_code,
  permission_name = EXCLUDED.permission_name,
  is_active       = EXCLUDED.is_active,
  sort_order      = EXCLUDED.sort_order,
  updated_at      = NOW();

-- 3. Plan entitlements: van enabled on pro/custom, off on basic/standard
INSERT INTO core.plan_feature (plan_code, feature_code, is_enabled)
SELECT
  p.plan_code,
  f.feature_code,
  CASE WHEN p.plan_code IN ('pro', 'custom') THEN TRUE ELSE FALSE END
FROM core.plan_master p
CROSS JOIN core.feature_master f
WHERE f.pack_code = 'van'
  AND f.is_active = TRUE
  AND p.plan_code IN ('basic', 'standard', 'pro', 'custom')
ON CONFLICT (plan_code, feature_code) DO NOTHING;

-- 4. Grant van permissions to admin role for all existing companies
INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
SELECT rm.company_id, rm.role_id, pm.permission_code, TRUE
FROM core.role_master rm
CROSS JOIN core.permission_master pm
WHERE rm.role_id = 1
  AND pm.feature_code LIKE 'van.%'
  AND pm.is_active = TRUE
  AND rm.record_status = 'ACTIVE'
ON CONFLICT (company_id, role_id, permission_code)
DO UPDATE SET is_allowed = TRUE, updated_at = NOW();

-- 5. Grant van permissions to Van Sales Man role (role_id=6) for all existing companies
INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
SELECT rm.company_id, rm.role_id, pm.permission_code, TRUE
FROM core.role_master rm
CROSS JOIN core.permission_master pm
WHERE rm.role_id = 6
  AND pm.feature_code LIKE 'van.%'
  AND pm.is_active = TRUE
  AND rm.record_status = 'ACTIVE'
ON CONFLICT (company_id, role_id, permission_code)
DO UPDATE SET is_allowed = TRUE, updated_at = NOW();
