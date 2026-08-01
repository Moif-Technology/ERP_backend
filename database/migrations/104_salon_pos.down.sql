-- 104_salon_pos.down.sql
-- Rollback for 104_salon_pos.sql.
--
-- This is the first down migration in the repo. It exists because 104 alters a
-- CHECK constraint on core.station_master, a table the live restaurant POS
-- depends on — that change needs a way back.
--
-- NOT reversed (deliberate, data-preserving):
--   - ops.sales_child.stylist_id / line_type. Dropping them would destroy
--     settled commission attribution. Left in place; they are nullable and inert.
--   - core.product_master.default_duration_minutes. Same reasoning.
-- Uncomment the block at the bottom only if you accept that data loss.

BEGIN;

-- 1. Restore the original three-value station type CHECK. Fails loudly if any
--    SALON_POS station still exists — that is intended, resolve those first.
ALTER TABLE core.station_master DROP CONSTRAINT IF EXISTS chk_station_type;
ALTER TABLE core.station_master ADD CONSTRAINT chk_station_type
  CHECK (station_type IN ('BACKOFFICE','COUNTER_POS','RESTAURANT_POS'));

-- 2. Remove the SALON software type and its feature grants.
--    software_type_feature rows cascade via fk_software_type_feature_type.
DELETE FROM core.software_type_feature WHERE software_type_id = 8;
DELETE FROM core.software_type_master  WHERE software_type_id = 8;

-- 3. Drop the salon job tables. Child first (FK), though CASCADE covers it.
DROP INDEX IF EXISTS ops.idx_job_child_stylist;
DROP TABLE IF EXISTS ops.job_child;
DROP TABLE IF EXISTS ops.job_master;

COMMIT;

-- Destructive extras — only if you accept losing settled stylist attribution:
-- BEGIN;
-- ALTER TABLE ops.sales_child       DROP COLUMN IF EXISTS stylist_id;
-- ALTER TABLE ops.sales_child       DROP COLUMN IF EXISTS line_type;
-- ALTER TABLE core.product_master   DROP COLUMN IF EXISTS default_duration_minutes;
-- COMMIT;
