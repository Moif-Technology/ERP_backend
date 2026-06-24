-- 085_station_master_refactor.sql
-- Branch = physical location only.
-- Station = software type (BACKOFFICE | COUNTER_POS | RESTAURANT_POS) running at a branch.
-- Replaces the legacy station_master (van/delivery table) with the correct POS-station concept.

BEGIN;

-- ================================================================
-- 1. Drop legacy station_master (empty, wrong structure — van/delivery fields)
-- ================================================================
DROP TABLE IF EXISTS core.station_master CASCADE;

-- ================================================================
-- 2. New station_master
-- ================================================================
CREATE TABLE core.station_master (
  id           BIGSERIAL    PRIMARY KEY,
  company_id   BIGINT       NOT NULL,
  branch_id    BIGINT       NOT NULL,   -- physical location FK
  station_id   BIGINT       NOT NULL,   -- sequential within company
  station_code VARCHAR(20)  NOT NULL,
  station_name VARCHAR(100) NOT NULL,
  station_type VARCHAR(30)  NOT NULL,
  counter_no   INTEGER      NULL,       -- 1,2,3... for POS stations; NULL for BACKOFFICE
  status       VARCHAR(10)  NOT NULL DEFAULT 'ACTIVE',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by   BIGINT NULL,
  modified_at  TIMESTAMPTZ  NULL,
  modified_by  BIGINT NULL,
  deleted_at   TIMESTAMPTZ  NULL,
  deleted_by   BIGINT NULL,
  is_deleted   BOOLEAN      NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_station_company_station UNIQUE (company_id, station_id),
  CONSTRAINT chk_station_type           CHECK  (station_type IN ('BACKOFFICE','COUNTER_POS','RESTAURANT_POS')),
  CONSTRAINT fk_station_branch          FOREIGN KEY (company_id, branch_id)
                                          REFERENCES core.branch_master (company_id, branch_id)
);

CREATE INDEX idx_stn_company_branch ON core.station_master (company_id, branch_id);
CREATE INDEX idx_stn_type            ON core.station_master (station_type);

-- ================================================================
-- 3. BACKOFFICE station (station_id=1) for every active company
-- ================================================================
INSERT INTO core.station_master
  (company_id, branch_id, station_id, station_code, station_name, station_type, counter_no)
SELECT
  company_id, 1, 1, 'BO-1', 'Back Office', 'BACKOFFICE', NULL
FROM core.company_master
WHERE is_deleted = FALSE;

-- ================================================================
-- 4. COUNTER_POS branches → stations under branch_id=1
--    station_id  = old branch_id  (preserves numeric link to existing data)
--    counter_no  = 1, 2, 3 ...  per company ordered by old branch_id
-- ================================================================
INSERT INTO core.station_master
  (company_id, branch_id, station_id, station_code, station_name, station_type, counter_no)
SELECT
  bm.company_id,
  1,
  bm.branch_id,
  bm.branch_code,
  bm.branch_name,
  'COUNTER_POS',
  ROW_NUMBER() OVER (PARTITION BY bm.company_id ORDER BY bm.branch_id)
FROM core.branch_master bm
WHERE bm.branch_type = 'COUNTER_POS'
  AND bm.is_deleted  = FALSE;

-- ================================================================
-- 5. RESTAURANT_POS branches → stations under branch_id=1
-- ================================================================
INSERT INTO core.station_master
  (company_id, branch_id, station_id, station_code, station_name, station_type, counter_no)
SELECT
  bm.company_id,
  1,
  bm.branch_id,
  bm.branch_code,
  bm.branch_name,
  'RESTAURANT_POS',
  ROW_NUMBER() OVER (PARTITION BY bm.company_id ORDER BY bm.branch_id)
FROM core.branch_master bm
WHERE bm.branch_type = 'RESTAURANT_POS'
  AND bm.is_deleted  = FALSE;

-- ================================================================
-- 6. Migrate product_inventory: POS branches → branch_id=1
--    Unique constraint: (company_id, branch_id, product_id)
--    Step a: merge qty into existing HQ rows
--    Step b: delete the now-merged POS rows (avoid unique violation in step c)
--    Step c: move remaining POS rows (no HQ counterpart) to branch_id=1
-- ================================================================

-- 6a. Merge into HQ
UPDATE core.product_inventory AS hq
SET
  qty_on_hand = hq.qty_on_hand + pos.qty_on_hand,
  pack_qty    = hq.pack_qty    + pos.pack_qty,
  modified_at = CURRENT_TIMESTAMP
FROM core.product_inventory pos
JOIN core.branch_master bm
  ON  bm.company_id  = pos.company_id
  AND bm.branch_id   = pos.branch_id
  AND bm.branch_type IN ('COUNTER_POS','RESTAURANT_POS')
  AND bm.is_deleted  = FALSE
WHERE pos.is_deleted = FALSE
  AND hq.company_id  = pos.company_id
  AND hq.branch_id   = 1
  AND hq.product_id  = pos.product_id
  AND hq.is_deleted  = FALSE;

-- 6b. Delete merged POS rows
DELETE FROM core.product_inventory pos
USING core.branch_master bm
WHERE bm.company_id  = pos.company_id
  AND bm.branch_id   = pos.branch_id
  AND bm.branch_type IN ('COUNTER_POS','RESTAURANT_POS')
  AND bm.is_deleted  = FALSE
  AND pos.is_deleted = FALSE
  AND EXISTS (
    SELECT 1 FROM core.product_inventory hq
    WHERE hq.company_id = pos.company_id
      AND hq.branch_id  = 1
      AND hq.product_id = pos.product_id
      AND hq.is_deleted = FALSE
  );

-- 6c. Move remaining POS-only products to branch_id=1
UPDATE core.product_inventory
SET branch_id = 1, modified_at = CURRENT_TIMESTAMP
WHERE branch_id IN (
  SELECT branch_id FROM core.branch_master
  WHERE branch_type IN ('COUNTER_POS','RESTAURANT_POS') AND is_deleted = FALSE
)
AND is_deleted = FALSE;

-- ================================================================
-- 7. Add station_id to POS-scoped tables
--    For each: add column, then copy old POS branch_id → station_id,
--    and update branch_id → 1 (physical HQ)
-- ================================================================

-- core.pos_device_enrollment
ALTER TABLE core.pos_device_enrollment ADD COLUMN IF NOT EXISTS station_id BIGINT NULL;
UPDATE core.pos_device_enrollment
SET station_id = branch_id, branch_id = 1
WHERE branch_id IN (
  SELECT branch_id FROM core.branch_master
  WHERE branch_type IN ('COUNTER_POS','RESTAURANT_POS') AND is_deleted = FALSE
);

-- core.counter_parameter
ALTER TABLE core.counter_parameter ADD COLUMN IF NOT EXISTS station_id BIGINT NULL;
UPDATE core.counter_parameter
SET station_id = branch_id, branch_id = 1
WHERE branch_id IN (
  SELECT branch_id FROM core.branch_master
  WHERE branch_type IN ('COUNTER_POS','RESTAURANT_POS') AND is_deleted = FALSE
);

-- ops.cash_in_out
ALTER TABLE ops.cash_in_out ADD COLUMN IF NOT EXISTS station_id BIGINT NULL;
UPDATE ops.cash_in_out
SET station_id = branch_id, branch_id = 1
WHERE branch_id IN (
  SELECT branch_id FROM core.branch_master
  WHERE branch_type IN ('COUNTER_POS','RESTAURANT_POS') AND is_deleted = FALSE
);

-- ops.counter_close
ALTER TABLE ops.counter_close ADD COLUMN IF NOT EXISTS station_id BIGINT NULL;
UPDATE ops.counter_close
SET station_id = branch_id, branch_id = 1
WHERE branch_id IN (
  SELECT branch_id FROM core.branch_master
  WHERE branch_type IN ('COUNTER_POS','RESTAURANT_POS') AND is_deleted = FALSE
)
AND is_deleted = FALSE;

-- ops.daily_counter_transaction
ALTER TABLE ops.daily_counter_transaction ADD COLUMN IF NOT EXISTS station_id BIGINT NULL;
UPDATE ops.daily_counter_transaction
SET station_id = branch_id, branch_id = 1
WHERE branch_id IN (
  SELECT branch_id FROM core.branch_master
  WHERE branch_type IN ('COUNTER_POS','RESTAURANT_POS') AND is_deleted = FALSE
)
AND is_deleted = FALSE;

-- ops.kot_master
ALTER TABLE ops.kot_master ADD COLUMN IF NOT EXISTS station_id BIGINT NULL;
UPDATE ops.kot_master
SET station_id = branch_id, branch_id = 1
WHERE branch_id IN (
  SELECT branch_id FROM core.branch_master
  WHERE branch_type IN ('COUNTER_POS','RESTAURANT_POS') AND is_deleted = FALSE
)
AND is_deleted = FALSE;

-- ops.kot_child
ALTER TABLE ops.kot_child ADD COLUMN IF NOT EXISTS station_id BIGINT NULL;
UPDATE ops.kot_child
SET station_id = branch_id, branch_id = 1
WHERE branch_id IN (
  SELECT branch_id FROM core.branch_master
  WHERE branch_type IN ('COUNTER_POS','RESTAURANT_POS') AND is_deleted = FALSE
)
AND is_deleted = FALSE;

-- ops.kot_master_temp (staging table, no is_deleted)
ALTER TABLE ops.kot_master_temp ADD COLUMN IF NOT EXISTS station_id BIGINT NULL;
UPDATE ops.kot_master_temp
SET station_id = branch_id, branch_id = 1
WHERE branch_id IN (
  SELECT branch_id FROM core.branch_master
  WHERE branch_type IN ('COUNTER_POS','RESTAURANT_POS') AND is_deleted = FALSE
);

-- ops.kot_child_temp (staging table, no is_deleted)
ALTER TABLE ops.kot_child_temp ADD COLUMN IF NOT EXISTS station_id BIGINT NULL;
UPDATE ops.kot_child_temp
SET station_id = branch_id, branch_id = 1
WHERE branch_id IN (
  SELECT branch_id FROM core.branch_master
  WHERE branch_type IN ('COUNTER_POS','RESTAURANT_POS') AND is_deleted = FALSE
);

-- ops.sales_master
ALTER TABLE ops.sales_master ADD COLUMN IF NOT EXISTS station_id BIGINT NULL;
UPDATE ops.sales_master
SET station_id = branch_id, branch_id = 1
WHERE branch_id IN (
  SELECT branch_id FROM core.branch_master
  WHERE branch_type IN ('COUNTER_POS','RESTAURANT_POS') AND is_deleted = FALSE
)
AND is_deleted = FALSE;

-- ops.sales_child
ALTER TABLE ops.sales_child ADD COLUMN IF NOT EXISTS station_id BIGINT NULL;
UPDATE ops.sales_child
SET station_id = branch_id, branch_id = 1
WHERE branch_id IN (
  SELECT branch_id FROM core.branch_master
  WHERE branch_type IN ('COUNTER_POS','RESTAURANT_POS') AND is_deleted = FALSE
)
AND is_deleted = FALSE;

-- ================================================================
-- 8. Soft-delete old COUNTER_POS / RESTAURANT_POS branch records
--    They are now represented as station_master rows under branch_id=1
-- ================================================================
UPDATE core.branch_master
SET
  status     = 'INACTIVE',
  is_deleted = TRUE,
  deleted_at = CURRENT_TIMESTAMP,
  updated_at = CURRENT_TIMESTAMP
WHERE branch_type IN ('COUNTER_POS','RESTAURANT_POS')
  AND is_deleted = FALSE;

COMMIT;
