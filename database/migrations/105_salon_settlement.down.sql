-- 105_salon_settlement.down.sql
-- Reverses 105. Dropping job_id / sales_id discards the link between a
-- posted bill and the job it came from. Recoverable from:
--   SELECT company_id, sales_id, job_id FROM ops.sales_master
--    WHERE job_id IS NOT NULL;

BEGIN;

DROP INDEX IF EXISTS ops.uq_job_master_sales;
DROP INDEX IF EXISTS ops.uq_salon_job_master_sales;

ALTER TABLE ops.job_master
  DROP CONSTRAINT IF EXISTS fk_job_master_sales;
ALTER TABLE ops.job_master
  DROP CONSTRAINT IF EXISTS fk_salon_job_master_sales;
ALTER TABLE ops.job_master
  DROP COLUMN IF EXISTS sales_id;

DROP INDEX IF EXISTS ops.ix_sales_master_job;
DROP INDEX IF EXISTS ops.ix_sales_master_salon_job;

ALTER TABLE ops.sales_master
  DROP CONSTRAINT IF EXISTS fk_sales_master_job;
ALTER TABLE ops.sales_master
  DROP CONSTRAINT IF EXISTS fk_sales_master_salon_job;

ALTER TABLE ops.sales_master
  DROP COLUMN IF EXISTS job_id;
ALTER TABLE ops.sales_master
  DROP COLUMN IF EXISTS salon_job_id;

ALTER TABLE ops.sales_child
  DROP CONSTRAINT IF EXISTS chk_sales_child_line_type;

DROP INDEX IF EXISTS ops.ix_sales_child_stylist;

COMMIT;
