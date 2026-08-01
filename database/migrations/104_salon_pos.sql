-- 104_salon_pos.sql
-- SalonPOS: services + retail in one job, stylist per line, walk-in first.
--
-- WHY NEW TABLES INSTEAD OF REUSING ops.kot_master:
--   ops.kot_master's primary key is kot_master_id alone (no company_id), but
--   kot.repository.js:5-21 allocates ids as per-company MAX+1. Company 2's job #1
--   therefore collides with company 1's KOT #1 (23505). This is latent today only
--   because exactly one company exists. A salon tenant IS the second company.
--   Rather than re-key the live restaurant tables (untestable locally: 0 products,
--   empty station_master, no POS tests, no CI), salon gets correctly-keyed tables.
--   The restaurant multi-tenant defect remains OPEN and tracked separately.
--
-- Idempotent. Wrapped in a transaction — a partial apply must be impossible,
-- because step 6 drops a CHECK constraint before recreating it.
-- The CONCURRENT index at the end runs OUTSIDE this transaction (see runner).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Salon job master. Composite (company_id, job_id) uniqueness — the whole
--    point of not reusing kot_master.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ops.job_master (
  id                 BIGSERIAL     PRIMARY KEY,
  company_id         BIGINT        NOT NULL,
  branch_id          BIGINT        NOT NULL,
  station_id         BIGINT        NULL,

  job_id             BIGINT        NOT NULL,            -- sequential within company
  job_no             VARCHAR(30)   NOT NULL DEFAULT '', -- SJ-0001, via nextDocNo
  job_status         VARCHAR(20)   NOT NULL DEFAULT 'OPEN',

  job_date           DATE          NOT NULL DEFAULT CURRENT_DATE,
  job_time           TIME          NOT NULL DEFAULT CURRENT_TIME,

  -- Booking-ready (phase 2). start/end are what a calendar needs to compute
  -- when a chair frees up; duration on the child line alone cannot answer that.
  start_time         TIMESTAMPTZ   NULL,
  end_time           TIMESTAMPTZ   NULL,
  appointment_id     BIGINT        NULL,

  -- NULL = walk-in. Deliberately NOT 0: ops.kot_master has an FK to
  -- biz.customer_master and no customer_id = 0 row exists, so restaurant's
  -- "0 = walk-in" convention fails on save. Salon is walk-in-first, so this
  -- path must not be a trap.
  customer_id        BIGINT        NULL,

  chair_id           BIGINT        NULL,   -- core.table_master row
  area_id            BIGINT        NULL,
  primary_stylist_id BIGINT        NULL,   -- job-level default (decision D4)

  bill_discount      NUMERIC(18,3) NOT NULL DEFAULT 0,
  sub_total          NUMERIC(18,3) NOT NULL DEFAULT 0,
  tax_1_amount       NUMERIC(18,3) NOT NULL DEFAULT 0,
  tax_1_rate         NUMERIC(9,3)  NOT NULL DEFAULT 0,
  round_off_adj      NUMERIC(18,3) NOT NULL DEFAULT 0,
  amount             NUMERIC(18,3) NOT NULL DEFAULT 0,

  remarks            VARCHAR(500)  NULL,
  record_status      VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE',
  is_deleted         BOOLEAN       NOT NULL DEFAULT FALSE,
  created_by         BIGINT        NULL,
  modified_by        BIGINT        NULL,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_job_master_company_job UNIQUE (company_id, job_id),
  CONSTRAINT chk_job_status
    CHECK (job_status IN ('OPEN','HELD','SETTLED','CANCELLED'))
);

-- ---------------------------------------------------------------------------
-- 2. Salon job lines. Composite FK to master so a salon line can never attach
--    to another tenant's job (the single-column FK on kot_child allows exactly
--    that today).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ops.job_child (
  id               BIGSERIAL     PRIMARY KEY,
  company_id       BIGINT        NOT NULL,
  branch_id        BIGINT        NOT NULL,
  station_id       BIGINT        NULL,

  job_id           BIGINT        NOT NULL,
  line_id          BIGINT        NOT NULL,   -- sequential within (company, job)

  -- PRODUCT = retail (shampoo, serum). SERVICE = labour (cut, colour).
  line_type        VARCHAR(16)   NOT NULL DEFAULT 'PRODUCT',

  -- Per-line stylist (decision D4). Inherits primary_stylist_id at insert time,
  -- overridable per line so two stylists can share one customer. BIGINT to match
  -- every other staff identifier in the schema — a VARCHAR would force a cast in
  -- every commission join and defeat the index below.
  stylist_id       BIGINT        NULL,
  duration_minutes INTEGER       NULL,
  service_status   VARCHAR(16)   NULL,

  product_id       BIGINT        NOT NULL,
  barcode          VARCHAR(50)   NOT NULL DEFAULT '',
  short_description VARCHAR(200) NOT NULL DEFAULT '',
  group_id         BIGINT        NOT NULL DEFAULT 0,

  qty              NUMERIC(18,3) NOT NULL DEFAULT 0,
  unit_price       NUMERIC(18,3) NOT NULL DEFAULT 0,
  unit_cost        NUMERIC(18,3) NOT NULL DEFAULT 0,
  amount           NUMERIC(18,3) NOT NULL DEFAULT 0,
  item_discount    NUMERIC(18,3) NOT NULL DEFAULT 0,
  sub_total        NUMERIC(18,3) NOT NULL DEFAULT 0,
  line_total       NUMERIC(18,3) NOT NULL DEFAULT 0,
  tax_1_amount     NUMERIC(18,3) NOT NULL DEFAULT 0,
  tax_1_rate       NUMERIC(9,3)  NOT NULL DEFAULT 0,

  remarks          VARCHAR(500)  NULL,
  record_status    VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE',
  is_deleted       BOOLEAN       NOT NULL DEFAULT FALSE,
  created_by       BIGINT        NULL,
  modified_by      BIGINT        NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_job_child_company_job_line UNIQUE (company_id, job_id, line_id),
  CONSTRAINT fk_job_child_master
    FOREIGN KEY (company_id, job_id)
    REFERENCES ops.job_master (company_id, job_id) ON DELETE CASCADE,
  CONSTRAINT chk_salon_line_type
    CHECK (line_type IN ('PRODUCT','SERVICE')),
  CONSTRAINT chk_salon_service_status
    CHECK (service_status IS NULL
           OR service_status IN ('WAITING','IN_PROGRESS','DONE')),
  -- A SERVICE line without a stylist is unbillable and uncommissionable.
  -- Enforced in the DB, not only in JS, so no future code path can bypass it.
  CONSTRAINT chk_salon_service_needs_stylist
    CHECK (line_type <> 'SERVICE' OR stylist_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_job_master_open
  ON ops.job_master (company_id, station_id, job_status)
  WHERE job_status <> 'SETTLED' AND is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_job_master_chair
  ON ops.job_master (company_id, chair_id)
  WHERE job_status <> 'SETTLED' AND is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_job_child_job
  ON ops.job_child (company_id, job_id);

-- One open job per chair. Restaurant has no equivalent because one waiter owns
-- a table; a salon chair holds one client at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_open_job_per_chair
  ON ops.job_master (company_id, chair_id)
  WHERE job_status IN ('OPEN','HELD') AND is_deleted = FALSE AND chair_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Service metadata on the shared catalogue (decision D1: services live in
--    core.product_master as product_type = 'SERVICE').
--
--    NOTE: v1 of the plan wanted UPPER(TRIM(product_type)) across the table.
--    Dropped — product_type is free-text VARCHAR(50) surfaced raw to clients and
--    round-tripped by bulk import, so rewriting it would corrupt tenant display
--    data ("Raw Material" -> "RAW MATERIAL") irreversibly for a salon-only feature.
--    Salon matches case-insensitively instead (UPPER(product_type) = 'SERVICE').
-- ---------------------------------------------------------------------------
ALTER TABLE core.product_master
  ADD COLUMN IF NOT EXISTS default_duration_minutes INTEGER NULL;

-- ---------------------------------------------------------------------------
-- 4. Stylist must survive settlement, or commission is uncomputable.
--    job_child is a working set; sales_child is the ledger.
-- ---------------------------------------------------------------------------
ALTER TABLE ops.sales_child
  ADD COLUMN IF NOT EXISTS stylist_id BIGINT NULL;

ALTER TABLE ops.sales_child
  ADD COLUMN IF NOT EXISTS line_type VARCHAR(16) NULL;

-- ---------------------------------------------------------------------------
-- 5. Software type 8 = SALON.
--    Type 7 is SERVICE (102_service_case_management.sql:237) — NOT free.
--    software_type_feature.software_type_id is an FK to software_type_master,
--    so the master row must exist first.
-- ---------------------------------------------------------------------------
INSERT INTO core.software_type_master
  (software_type_id, software_code, software_name, description, display_order)
VALUES
  (8, 'SALON', 'Salon ERP',
   'Salon POS: services and retail in one job, stylist assignment per line.', 8)
ON CONFLICT (software_type_id) DO UPDATE
  SET software_name = EXCLUDED.software_name,
      description   = EXCLUDED.description;

-- feature_code is an FK to core.feature_master — literals like 'salon' would
-- abort. And `allowed` must be the FULL pack list, never a subset:
-- 100_software_type_feature_seed.sql:13-20 documents that a narrow subset
-- silently stripped hr/garage access. is_granted is what varies, not membership.
-- Enumerate EVERY active feature, deriving is_granted from the pack. Listing
-- packs by hand is how the stripping bug happens: the live catalogue already
-- carries a 'service' pack that a hand-written list omitted, and any pack added
-- later would be missed the same way. This form cannot drift.
INSERT INTO core.software_type_feature (software_type_id, feature_code, is_granted, created_at)
SELECT 8,
       feature_code,
       (pack_code IN ('core','pos')) AS is_granted,
       NOW()
  FROM core.feature_master
 WHERE is_active
ON CONFLICT (software_type_id, feature_code)
  DO UPDATE SET is_granted = EXCLUDED.is_granted;

-- 5b. NOTE — core.software_type_feature CANNOT disable a feature.
--
--     An earlier version of this migration set is_granted = FALSE for the
--     restaurant-only POS codes (pos.takeaway, pos.delivery, pos.kds, ...)
--     expecting the salon POS to stop showing those buttons. It had ZERO effect.
--
--     entitlement.service.js:223 applySoftwareTypeScope does:
--         allowed  = every row for the software type -> feature keeps the PLAN's value
--         granted  = rows with is_granted = TRUE     -> force-set to TRUE
--     so is_granted = FALSE means only "not force-granted". The plan still
--     decides, and the 'pro' plan enables everything — every feature resolved to
--     TRUE regardless.
--
--     The lever that actually disables per tenant is core.tenant_feature_override
--     (is_enabled = FALSE), applied LAST at entitlement.service.js:274. Because
--     it is per-COMPANY, not per software type, it belongs in the tenant seed
--     (scripts/seed-salon-tenant.mjs), not in this migration.

-- ---------------------------------------------------------------------------
-- 6. Allow SALON_POS terminals. 085_station_master_refactor.sql pinned
--    station_type to three values; enrolling a salon till fails without this.
--    DROP IF EXISTS keeps the migration re-runnable.
-- ---------------------------------------------------------------------------
ALTER TABLE core.station_master DROP CONSTRAINT IF EXISTS chk_station_type;
ALTER TABLE core.station_master ADD CONSTRAINT chk_station_type
  CHECK (station_type IN ('BACKOFFICE','COUNTER_POS','RESTAURANT_POS','SALON_POS'));

COMMIT;

-- ---------------------------------------------------------------------------
-- 7. Stylist reporting index. CONCURRENTLY cannot run inside a transaction —
--    the runner executes this separately. ops.job_child is new and empty
--    on first apply, so this is instant; CONCURRENTLY matters on re-runs.
-- ---------------------------------------------------------------------------
-- RUNNER_CONCURRENT_BLOCK_START
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_child_stylist
  ON ops.job_child (company_id, stylist_id)
  WHERE stylist_id IS NOT NULL;
-- RUNNER_CONCURRENT_BLOCK_END
