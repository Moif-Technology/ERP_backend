-- 106_salon_settle_delete_job.sql
-- After settlement, salon deletes job master/child rows. sales_master.job_id
-- remains as a historical reference, so the FK to job_master must go.
-- Supports both old (salon_job_*) and new (job_*) table names.

BEGIN;

ALTER TABLE ops.sales_master
  DROP CONSTRAINT IF EXISTS fk_sales_master_job;
ALTER TABLE ops.sales_master
  DROP CONSTRAINT IF EXISTS fk_sales_master_salon_job;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'ops' AND table_name = 'job_master'
  ) THEN
    ALTER TABLE ops.job_master DROP CONSTRAINT IF EXISTS fk_job_master_sales;
    ALTER TABLE ops.job_master DROP CONSTRAINT IF EXISTS fk_salon_job_master_sales;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'ops' AND table_name = 'salon_job_master'
  ) THEN
    ALTER TABLE ops.salon_job_master DROP CONSTRAINT IF EXISTS fk_salon_job_master_sales;
  END IF;
END $$;

DROP INDEX IF EXISTS uq_job_master_sales;
DROP INDEX IF EXISTS uq_salon_job_master_sales;

COMMIT;
