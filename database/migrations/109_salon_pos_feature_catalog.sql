-- 109_salon_pos_feature_catalog.sql
-- Adds the SalonPOS-specific switches used by Super Admin and route gates.

BEGIN;

INSERT INTO core.feature_master
  (feature_code, feature_name, pack_code, parent_feature_code, feature_type, sort_order, is_active)
VALUES
  ('pos.full_ui',               'Full POS UI',                  'pos', 'pos', 'feature', 224, TRUE),
  ('pos.ui.basic',              'Basic POS UI',                 'pos', 'pos', 'feature', 225, TRUE),
  ('pos.ui.normal',             'Normal POS UI',                'pos', 'pos', 'feature', 226, TRUE),
  ('pos.salon.jobs',            'Salon jobs',                   'pos', 'pos', 'feature', 230, TRUE),
  ('pos.salon.stylists',        'Salon stylists',               'pos', 'pos', 'feature', 231, TRUE),
  ('pos.salon.appointments',    'Salon appointments',           'pos', 'pos', 'feature', 232, TRUE),
  ('pos.salon.service_status',  'Salon service status',         'pos', 'pos', 'feature', 233, TRUE),
  ('pos.salon.stylist_reassign','Salon stylist reassignment',   'pos', 'pos', 'feature', 234, TRUE)
ON CONFLICT (feature_code) DO UPDATE SET
  feature_name        = EXCLUDED.feature_name,
  pack_code           = EXCLUDED.pack_code,
  parent_feature_code = EXCLUDED.parent_feature_code,
  feature_type        = EXCLUDED.feature_type,
  sort_order          = EXCLUDED.sort_order,
  is_active           = EXCLUDED.is_active,
  updated_at          = NOW();

INSERT INTO core.plan_feature (plan_code, feature_code, is_enabled)
SELECT p.plan_code, f.feature_code,
       CASE WHEN p.plan_code IN ('standard', 'pro', 'custom') THEN TRUE ELSE FALSE END
FROM core.plan_master p
CROSS JOIN core.feature_master f
WHERE f.feature_code IN (
  'pos.full_ui',
  'pos.ui.basic',
  'pos.ui.normal',
  'pos.salon.jobs',
  'pos.salon.stylists',
  'pos.salon.appointments',
  'pos.salon.service_status',
  'pos.salon.stylist_reassign'
)
  AND p.plan_code IN ('basic', 'standard', 'pro', 'custom')
ON CONFLICT (plan_code, feature_code) DO NOTHING;

INSERT INTO core.software_type_feature (software_type_id, feature_code, is_granted, created_at)
SELECT stm.software_type_id,
       f.feature_code,
       CASE
         WHEN stm.software_code = 'SALON' THEN TRUE
         WHEN stm.software_code IN ('RESTAURANT','POS') AND f.feature_code IN ('pos.full_ui','pos.ui.basic','pos.ui.normal') THEN TRUE
         ELSE FALSE
       END,
       NOW()
FROM core.software_type_master stm
CROSS JOIN core.feature_master f
WHERE f.feature_code IN (
  'pos.full_ui',
  'pos.ui.basic',
  'pos.ui.normal',
  'pos.salon.jobs',
  'pos.salon.stylists',
  'pos.salon.appointments',
  'pos.salon.service_status',
  'pos.salon.stylist_reassign'
)
ON CONFLICT (software_type_id, feature_code)
DO UPDATE SET is_granted = EXCLUDED.is_granted;

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
WHERE f.feature_code IN (
  'pos.full_ui',
  'pos.ui.basic',
  'pos.ui.normal',
  'pos.salon.jobs',
  'pos.salon.stylists',
  'pos.salon.appointments',
  'pos.salon.service_status',
  'pos.salon.stylist_reassign'
)
  AND f.feature_type = 'feature'
ON CONFLICT (permission_code) DO NOTHING;

INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
SELECT rm.company_id, rm.role_id, pm.permission_code, TRUE
FROM core.role_master rm
CROSS JOIN core.permission_master pm
WHERE rm.role_id = 1
  AND pm.feature_code IN (
    'pos.full_ui',
    'pos.ui.basic',
    'pos.ui.normal',
    'pos.salon.jobs',
    'pos.salon.stylists',
    'pos.salon.appointments',
    'pos.salon.service_status',
    'pos.salon.stylist_reassign'
  )
  AND pm.is_active = TRUE
  AND rm.record_status = 'ACTIVE'
ON CONFLICT (company_id, role_id, permission_code)
DO UPDATE SET is_allowed = TRUE, updated_at = NOW();

COMMIT;
