-- 102: Service & Case Management framework — generic, configurable case-based
-- service business module (typing centres initially; any service business later).
-- Run on both local (5432) and production (5433) DB.
--
-- Schema: `service` — dynamic category -> service -> sub-service catalogue,
-- customer cases with auto-generated tasks/documents/payments/invoices.
-- Customers are NOT duplicated here: cases reference biz.customer_master directly
-- (customer_type column on that table already distinguishes individual/company).

CREATE SCHEMA IF NOT EXISTS service;

-- ============================================================================
-- 1. CATALOGUE — categories, services (self-referencing for sub-services)
-- ============================================================================

CREATE TABLE IF NOT EXISTS service.category_master (
  id            BIGSERIAL     PRIMARY KEY,
  company_id    BIGINT        NOT NULL,
  category_id   BIGINT        NOT NULL,
  category_name VARCHAR(150)  NOT NULL,
  description   VARCHAR(500),
  sort_order    INTEGER       NOT NULL DEFAULT 0,
  record_status VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by    BIGINT,
  modified_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  modified_by   BIGINT,
  CONSTRAINT uq_service_category_company_id   UNIQUE (company_id, category_id),
  CONSTRAINT uq_service_category_company_name UNIQUE (company_id, category_name)
);
CREATE INDEX IF NOT EXISTS idx_service_category_company ON service.category_master (company_id, record_status);

CREATE TABLE IF NOT EXISTS service.service_master (
  id                  BIGSERIAL     PRIMARY KEY,
  company_id          BIGINT        NOT NULL,
  service_id          BIGINT        NOT NULL,
  category_id         BIGINT        NOT NULL REFERENCES service.category_master (id),
  parent_service_id   BIGINT        NULL REFERENCES service.service_master (id),
  service_code        VARCHAR(30)   NOT NULL,
  service_name        VARCHAR(200)  NOT NULL,
  is_group            BOOLEAN       NOT NULL DEFAULT FALSE,
  government_fee      NUMERIC(18,2) NOT NULL DEFAULT 0,
  service_charge      NUMERIC(18,2) NOT NULL DEFAULT 0,
  vat_percent         NUMERIC(5,2)  NOT NULL DEFAULT 0,
  expected_days       INTEGER       NOT NULL DEFAULT 1,
  expiry_months       INTEGER       NULL,
  is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
  sort_order          INTEGER       NOT NULL DEFAULT 0,
  record_status       VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE',
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by          BIGINT,
  modified_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  modified_by         BIGINT,
  CONSTRAINT uq_service_master_company_id   UNIQUE (company_id, service_id),
  CONSTRAINT uq_service_master_company_code UNIQUE (company_id, service_code)
);
CREATE INDEX IF NOT EXISTS idx_service_master_company        ON service.service_master (company_id, record_status);
CREATE INDEX IF NOT EXISTS idx_service_master_category       ON service.service_master (company_id, category_id);
CREATE INDEX IF NOT EXISTS idx_service_master_parent         ON service.service_master (parent_service_id);

CREATE TABLE IF NOT EXISTS service.service_task_template (
  id                          BIGSERIAL     PRIMARY KEY,
  company_id                  BIGINT        NOT NULL,
  service_id                  BIGINT        NOT NULL REFERENCES service.service_master (id) ON DELETE CASCADE,
  task_name                   VARCHAR(150)  NOT NULL,
  sort_order                  INTEGER       NOT NULL DEFAULT 0,
  default_assignee_staff_id   BIGINT        NULL,
  default_duration_days       INTEGER       NULL,
  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  modified_at                 TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_service_task_template_service ON service.service_task_template (service_id, sort_order);

CREATE TABLE IF NOT EXISTS service.service_document_requirement (
  id             BIGSERIAL     PRIMARY KEY,
  company_id     BIGINT        NOT NULL,
  service_id     BIGINT        NOT NULL REFERENCES service.service_master (id) ON DELETE CASCADE,
  document_name  VARCHAR(150)  NOT NULL,
  is_mandatory   BOOLEAN       NOT NULL DEFAULT TRUE,
  has_expiry     BOOLEAN       NOT NULL DEFAULT FALSE,
  sort_order     INTEGER       NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_service_document_requirement_service ON service.service_document_requirement (service_id, sort_order);

CREATE TABLE IF NOT EXISTS service.service_reminder_rule (
  id           BIGSERIAL     PRIMARY KEY,
  company_id   BIGINT        NOT NULL,
  service_id   BIGINT        NOT NULL REFERENCES service.service_master (id) ON DELETE CASCADE,
  days_before  INTEGER       NOT NULL,
  channel      VARCHAR(20)   NOT NULL DEFAULT 'SYSTEM',
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_service_reminder_rule UNIQUE (service_id, days_before, channel)
);

-- ============================================================================
-- 2. CASES — the customer job, referencing biz.customer_master directly
-- ============================================================================

CREATE TABLE IF NOT EXISTS service.case_master (
  id                  BIGSERIAL     PRIMARY KEY,
  company_id          BIGINT        NOT NULL,
  branch_id           BIGINT        NOT NULL,
  case_id             BIGINT        NOT NULL,
  case_code           VARCHAR(30)   NOT NULL,
  customer_id         BIGINT        NOT NULL REFERENCES biz.customer_master (id),
  service_id          BIGINT        NOT NULL REFERENCES service.service_master (id),
  status              VARCHAR(30)   NOT NULL DEFAULT 'NEW',
  priority            VARCHAR(20)   NOT NULL DEFAULT 'NORMAL',
  assigned_staff_id   BIGINT        NULL,
  opened_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  due_date            DATE          NULL,
  completed_at        TIMESTAMPTZ   NULL,
  government_fee      NUMERIC(18,2) NOT NULL DEFAULT 0,
  service_charge      NUMERIC(18,2) NOT NULL DEFAULT 0,
  vat_percent         NUMERIC(5,2)  NOT NULL DEFAULT 0,
  vat_amount          NUMERIC(18,2) NOT NULL DEFAULT 0,
  quoted_total        NUMERIC(18,2) NOT NULL DEFAULT 0,
  notes               TEXT,
  record_status       VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE',
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by          BIGINT,
  modified_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  modified_by         BIGINT,
  CONSTRAINT uq_service_case_company_id   UNIQUE (company_id, case_id),
  CONSTRAINT uq_service_case_company_code UNIQUE (company_id, case_code)
);
CREATE INDEX IF NOT EXISTS idx_service_case_company         ON service.case_master (company_id, record_status);
CREATE INDEX IF NOT EXISTS idx_service_case_branch          ON service.case_master (company_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_service_case_customer         ON service.case_master (company_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_service_case_service          ON service.case_master (company_id, service_id);
CREATE INDEX IF NOT EXISTS idx_service_case_status           ON service.case_master (company_id, status);
CREATE INDEX IF NOT EXISTS idx_service_case_assigned_staff   ON service.case_master (company_id, assigned_staff_id);
CREATE INDEX IF NOT EXISTS idx_service_case_due_date         ON service.case_master (company_id, due_date);

CREATE TABLE IF NOT EXISTS service.case_status_history (
  id           BIGSERIAL     PRIMARY KEY,
  company_id   BIGINT        NOT NULL,
  case_id      BIGINT        NOT NULL REFERENCES service.case_master (id) ON DELETE CASCADE,
  from_status  VARCHAR(30),
  to_status    VARCHAR(30)   NOT NULL,
  changed_by   BIGINT,
  changed_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  remarks      VARCHAR(300)
);
CREATE INDEX IF NOT EXISTS idx_service_case_status_history_case ON service.case_status_history (case_id, changed_at);

CREATE TABLE IF NOT EXISTS service.case_task (
  id                  BIGSERIAL     PRIMARY KEY,
  company_id          BIGINT        NOT NULL,
  case_id             BIGINT        NOT NULL REFERENCES service.case_master (id) ON DELETE CASCADE,
  task_id             INTEGER       NOT NULL,
  task_name           VARCHAR(150)  NOT NULL,
  status              VARCHAR(30)   NOT NULL DEFAULT 'PENDING',
  assignee_staff_id   BIGINT        NULL,
  due_date            DATE          NULL,
  notes               TEXT,
  sort_order          INTEGER       NOT NULL DEFAULT 0,
  completed_at        TIMESTAMPTZ   NULL,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  modified_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_service_case_task UNIQUE (case_id, task_id)
);
CREATE INDEX IF NOT EXISTS idx_service_case_task_company  ON service.case_task (company_id, status);
CREATE INDEX IF NOT EXISTS idx_service_case_task_assignee ON service.case_task (company_id, assignee_staff_id, status);
CREATE INDEX IF NOT EXISTS idx_service_case_task_case     ON service.case_task (case_id);

CREATE TABLE IF NOT EXISTS service.case_document (
  id             BIGSERIAL     PRIMARY KEY,
  company_id     BIGINT        NOT NULL,
  case_id        BIGINT        NOT NULL REFERENCES service.case_master (id) ON DELETE CASCADE,
  document_id    INTEGER       NOT NULL,
  document_name  VARCHAR(150)  NOT NULL,
  status         VARCHAR(30)   NOT NULL DEFAULT 'PENDING',
  file_name      VARCHAR(255),
  file_path      VARCHAR(500),
  file_size      INTEGER,
  expiry_date    DATE          NULL,
  uploaded_at    TIMESTAMPTZ   NULL,
  uploaded_by    BIGINT        NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  modified_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_service_case_document UNIQUE (case_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_service_case_document_company_expiry ON service.case_document (company_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_service_case_document_case           ON service.case_document (case_id);

CREATE TABLE IF NOT EXISTS service.case_payment (
  id              BIGSERIAL     PRIMARY KEY,
  company_id      BIGINT        NOT NULL,
  branch_id       BIGINT        NOT NULL,
  case_id         BIGINT        NOT NULL REFERENCES service.case_master (id) ON DELETE CASCADE,
  payment_id      INTEGER       NOT NULL,
  payment_type    VARCHAR(40)   NOT NULL,
  amount          NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  payment_method  VARCHAR(30)   NOT NULL,
  paid_by         VARCHAR(200),
  payment_date    DATE          NOT NULL DEFAULT CURRENT_DATE,
  reference       VARCHAR(100),
  remarks         VARCHAR(500),
  record_status   VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by      BIGINT,
  CONSTRAINT uq_service_case_payment UNIQUE (case_id, payment_id)
);
CREATE INDEX IF NOT EXISTS idx_service_case_payment_company_date ON service.case_payment (company_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_service_case_payment_case         ON service.case_payment (case_id);

CREATE TABLE IF NOT EXISTS service.case_invoice (
  id              BIGSERIAL     PRIMARY KEY,
  company_id      BIGINT        NOT NULL,
  branch_id       BIGINT        NOT NULL,
  case_id         BIGINT        NOT NULL REFERENCES service.case_master (id),
  invoice_id      BIGINT        NOT NULL,
  invoice_no      VARCHAR(30)   NOT NULL,
  invoice_date    DATE          NOT NULL DEFAULT CURRENT_DATE,
  government_fee  NUMERIC(18,2) NOT NULL DEFAULT 0,
  service_charge  NUMERIC(18,2) NOT NULL DEFAULT 0,
  vat_amount      NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
  status          VARCHAR(20)   NOT NULL DEFAULT 'ISSUED',
  record_status   VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by      BIGINT,
  modified_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  modified_by     BIGINT,
  CONSTRAINT uq_service_case_invoice_company_id UNIQUE (company_id, invoice_id),
  CONSTRAINT uq_service_case_invoice_company_no UNIQUE (company_id, invoice_no)
);
CREATE INDEX IF NOT EXISTS idx_service_case_invoice_case ON service.case_invoice (case_id);

-- ============================================================================
-- 3. Software type — register "Service & Case Management" as its own type
--    (same tier as GARAGE/CRM/HR), so it can be sold standalone or bundled.
-- ============================================================================

INSERT INTO core.software_type_master (software_type_id, software_code, software_name)
VALUES (7, 'SERVICE', 'Service & Case Management')
ON CONFLICT (software_type_id) DO NOTHING;

-- ============================================================================
-- 4. Features, permissions, plan entitlements, software-type grants, role grants
--    Pattern copied from api/database/migrations/095_van_features_permissions.sql
-- ============================================================================

INSERT INTO core.feature_master
  (feature_code, feature_name, pack_code, parent_feature_code, feature_type, sort_order, is_active)
VALUES
  ('service',               'Service & Case Management', 'service', NULL,      'pack',    800, TRUE),
  ('service.dashboard',     'Dashboard',                  'service', 'service', 'feature', 801, TRUE),
  ('service.categories',    'Service Catalogue',          'service', 'service', 'feature', 802, TRUE),
  ('service.cases',         'Cases',                      'service', 'service', 'feature', 803, TRUE),
  ('service.tasks',         'Task Board',                 'service', 'service', 'feature', 804, TRUE),
  ('service.payments',      'Payments',                   'service', 'service', 'feature', 805, TRUE),
  ('service.documents',     'Documents',                  'service', 'service', 'feature', 806, TRUE),
  ('service.expiry',        'Expiry & Renewal',           'service', 'service', 'feature', 807, TRUE),
  ('service.reports',       'Reports',                    'service', 'service', 'feature', 808, TRUE)
ON CONFLICT (feature_code) DO UPDATE SET
  feature_name        = EXCLUDED.feature_name,
  pack_code           = EXCLUDED.pack_code,
  parent_feature_code = EXCLUDED.parent_feature_code,
  feature_type        = EXCLUDED.feature_type,
  sort_order           = EXCLUDED.sort_order,
  is_active            = EXCLUDED.is_active,
  updated_at            = NOW();

INSERT INTO core.permission_master
  (permission_code, feature_code, action_code, permission_name, is_active, sort_order)
SELECT f.feature_code || '.' || a.action_code, f.feature_code, a.action_code,
       f.feature_name || ' - ' || INITCAP(a.action_code), TRUE, f.sort_order * 10 + a.action_sort
FROM core.feature_master f
CROSS JOIN (VALUES ('view',1),('create',2),('edit',3),('delete',4)) AS a(action_code, action_sort)
WHERE f.pack_code = 'service' AND f.feature_type = 'feature'
ON CONFLICT (permission_code) DO UPDATE SET
  feature_code    = EXCLUDED.feature_code,
  action_code     = EXCLUDED.action_code,
  permission_name = EXCLUDED.permission_name,
  is_active       = EXCLUDED.is_active,
  sort_order      = EXCLUDED.sort_order,
  updated_at      = NOW();

-- Plan entitlements: enabled on pro/custom by default (same tier as van/crm add-ons)
INSERT INTO core.plan_feature (plan_code, feature_code, is_enabled)
SELECT p.plan_code, f.feature_code,
       CASE WHEN p.plan_code IN ('pro', 'custom') THEN TRUE ELSE FALSE END
FROM core.plan_master p
CROSS JOIN core.feature_master f
WHERE f.pack_code = 'service'
  AND f.is_active = TRUE
  AND p.plan_code IN ('basic', 'standard', 'pro', 'custom')
ON CONFLICT (plan_code, feature_code) DO NOTHING;

-- Software-type grants: force-available on the new SERVICE type and on plain ERP backoffice
INSERT INTO core.software_type_feature (software_type_id, feature_code, is_granted)
SELECT st.software_type_id, f.feature_code, TRUE
FROM core.feature_master f
CROSS JOIN (VALUES (7), (6)) AS st(software_type_id)
WHERE f.pack_code = 'service' AND f.is_active = TRUE
ON CONFLICT (software_type_id, feature_code) DO UPDATE SET is_granted = EXCLUDED.is_granted;

-- Grant to Admin role (role_id=1) for every existing company
INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
SELECT rm.company_id, rm.role_id, pm.permission_code, TRUE
FROM core.role_master rm
CROSS JOIN core.permission_master pm
WHERE rm.role_id = 1
  AND pm.feature_code LIKE 'service.%'
  AND pm.is_active = TRUE
  AND rm.record_status = 'ACTIVE'
ON CONFLICT (company_id, role_id, permission_code)
DO UPDATE SET is_allowed = TRUE, updated_at = NOW();
