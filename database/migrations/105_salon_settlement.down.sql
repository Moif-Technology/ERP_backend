-- 105_salon_settlement.down.sql
--
-- Reverses 105. Dropping salon_job_id / sales_id discards the link between a
-- settled salon bill and its job; the sales and job rows themselves survive.
-- Run this only if no salon settlements have been taken, or if you have
-- captured the pairs first:
--   SELECT company_id, sales_id, salon_job_id FROM ops.sales_master
--    WHERE salon_job_id IS NOT NULL;

BEGIN;

DROP INDEX IF EXISTS ops.ix_sales_child_stylist;

ALTER TABLE ops.sales_child
  DROP CONSTRAINT IF EXISTS chk_sales_child_line_type;

DROP INDEX IF EXISTS ops.uq_salon_job_master_sales;

ALTER TABLE ops.salon_job_master
  DROP CONSTRAINT IF EXISTS fk_salon_job_master_sales;

ALTER TABLE ops.salon_job_master
  DROP COLUMN IF EXISTS sales_id;

DROP INDEX IF EXISTS ops.ix_sales_master_salon_job;

ALTER TABLE ops.sales_master
  DROP CONSTRAINT IF EXISTS fk_sales_master_salon_job;

ALTER TABLE ops.sales_master
  DROP COLUMN IF EXISTS salon_job_id;

COMMIT;
