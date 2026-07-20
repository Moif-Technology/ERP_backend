-- Van/Route master tables + features for backoffice van management
-- Run on both local and production DB.

-- 1. Ensure ops schema exists
CREATE SCHEMA IF NOT EXISTS ops;

-- 2. Van master
CREATE TABLE IF NOT EXISTS ops.van_master (
  id           SERIAL        PRIMARY KEY,
  company_id   INTEGER       NOT NULL,
  branch_id    INTEGER,
  van_id       INTEGER       NOT NULL,
  van_code     VARCHAR(50)   NOT NULL,
  van_name     VARCHAR(120)  NOT NULL,
  plate_no     VARCHAR(50),
  is_active    BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by   VARCHAR(120),
  modified_at  TIMESTAMPTZ,
  modified_by  VARCHAR(120),
  CONSTRAINT uq_van_master_company_vanid  UNIQUE (company_id, van_id),
  CONSTRAINT uq_van_master_company_code   UNIQUE (company_id, van_code)
);

-- 3. Route master
CREATE TABLE IF NOT EXISTS ops.route_master (
  id           SERIAL        PRIMARY KEY,
  company_id   INTEGER       NOT NULL,
  branch_id    INTEGER,
  route_id     INTEGER       NOT NULL,
  route_code   VARCHAR(50)   NOT NULL,
  route_name   VARCHAR(120)  NOT NULL,
  description  TEXT,
  is_active    BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by   VARCHAR(120),
  modified_at  TIMESTAMPTZ,
  modified_by  VARCHAR(120),
  CONSTRAINT uq_route_master_company_routeid UNIQUE (company_id, route_id),
  CONSTRAINT uq_route_master_company_code    UNIQUE (company_id, route_code)
);

-- 4. Route customer mapping
CREATE TABLE IF NOT EXISTS ops.route_customer (
  id          SERIAL       PRIMARY KEY,
  company_id  INTEGER      NOT NULL,
  route_id    INTEGER      NOT NULL,
  customer_id INTEGER      NOT NULL,
  sort_order  INTEGER      NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by  VARCHAR(120),
  CONSTRAINT uq_route_customer_unique UNIQUE (company_id, route_id, customer_id)
);

-- 5. Van day assignment (one per staff per day; upsert-friendly)
CREATE TABLE IF NOT EXISTS ops.van_day_assignment (
  id               SERIAL          PRIMARY KEY,
  company_id       INTEGER         NOT NULL,
  branch_id        INTEGER,
  staff_id         INTEGER         NOT NULL,
  van_id           INTEGER         NOT NULL,
  route_id         INTEGER,
  assignment_date  DATE            NOT NULL,
  opening_cash     NUMERIC(15,2)   NOT NULL DEFAULT 0,
  status           VARCHAR(20)     NOT NULL DEFAULT 'OPEN',
  created_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  created_by       VARCHAR(120),
  modified_at      TIMESTAMPTZ,
  modified_by      VARCHAR(120),
  CONSTRAINT uq_van_day_assignment UNIQUE (company_id, staff_id, assignment_date)
);

-- 6. New features
INSERT INTO core.feature_master
  (feature_code, feature_name, pack_code, parent_feature_code, feature_type, sort_order, is_active)
VALUES
  ('van.van_master',   'Van Master',    'van', 'van', 'feature', 707, TRUE),
  ('van.route_master', 'Route Master',  'van', 'van', 'feature', 708, TRUE),
  ('van.assignment',   'Day Assignment','van', 'van', 'feature', 709, TRUE)
ON CONFLICT (feature_code) DO UPDATE SET
  feature_name        = EXCLUDED.feature_name,
  pack_code           = EXCLUDED.pack_code,
  parent_feature_code = EXCLUDED.parent_feature_code,
  feature_type        = EXCLUDED.feature_type,
  sort_order          = EXCLUDED.sort_order,
  is_active           = EXCLUDED.is_active,
  updated_at          = NOW();

-- 7. Permissions for new features
INSERT INTO core.permission_master
  (permission_code, feature_code, action_code, permission_name, is_active, sort_order)
VALUES
  ('van.van_master.view',    'van.van_master',   'view',   'Van Master - View',       TRUE, 7071),
  ('van.van_master.create',  'van.van_master',   'create', 'Van Master - Create',     TRUE, 7072),
  ('van.van_master.edit',    'van.van_master',   'edit',   'Van Master - Edit',       TRUE, 7073),
  ('van.van_master.delete',  'van.van_master',   'delete', 'Van Master - Delete',     TRUE, 7074),
  ('van.route_master.view',  'van.route_master', 'view',   'Route Master - View',     TRUE, 7081),
  ('van.route_master.create','van.route_master', 'create', 'Route Master - Create',   TRUE, 7082),
  ('van.route_master.edit',  'van.route_master', 'edit',   'Route Master - Edit',     TRUE, 7083),
  ('van.route_master.delete','van.route_master', 'delete', 'Route Master - Delete',   TRUE, 7084),
  ('van.assignment.view',    'van.assignment',   'view',   'Day Assignment - View',   TRUE, 7091),
  ('van.assignment.create',  'van.assignment',   'create', 'Day Assignment - Create', TRUE, 7092)
ON CONFLICT (permission_code) DO UPDATE SET
  feature_code    = EXCLUDED.feature_code,
  action_code     = EXCLUDED.action_code,
  permission_name = EXCLUDED.permission_name,
  is_active       = EXCLUDED.is_active,
  sort_order      = EXCLUDED.sort_order,
  updated_at      = NOW();

-- 8. Plan entitlements for new features
INSERT INTO core.plan_feature (plan_code, feature_code, is_enabled)
SELECT
  p.plan_code,
  f.feature_code,
  CASE WHEN p.plan_code IN ('pro', 'custom') THEN TRUE ELSE FALSE END
FROM core.plan_master p
CROSS JOIN core.feature_master f
WHERE f.feature_code IN ('van.van_master', 'van.route_master', 'van.assignment')
  AND p.plan_code IN ('basic', 'standard', 'pro', 'custom')
ON CONFLICT (plan_code, feature_code) DO NOTHING;

-- 9. Grant all new van master/route master/assignment perms to admin (role_id=1)
INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
SELECT rm.company_id, rm.role_id, pm.permission_code, TRUE
FROM core.role_master rm
CROSS JOIN core.permission_master pm
WHERE rm.role_id = 1
  AND pm.feature_code IN ('van.van_master', 'van.route_master', 'van.assignment')
  AND pm.is_active = TRUE
  AND rm.record_status = 'ACTIVE'
ON CONFLICT (company_id, role_id, permission_code)
DO UPDATE SET is_allowed = TRUE, updated_at = NOW();

-- 10. Grant only assignment.view + assignment.create to Van Sales Man (role_id=6)
INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
SELECT rm.company_id, rm.role_id, pm.permission_code, TRUE
FROM core.role_master rm
CROSS JOIN core.permission_master pm
WHERE rm.role_id = 6
  AND pm.permission_code IN ('van.assignment.view', 'van.assignment.create')
  AND pm.is_active = TRUE
  AND rm.record_status = 'ACTIVE'
ON CONFLICT (company_id, role_id, permission_code)
DO UPDATE SET is_allowed = TRUE, updated_at = NOW();
