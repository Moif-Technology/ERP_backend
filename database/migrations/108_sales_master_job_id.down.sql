-- 108_sales_master_job_id.down.sql
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'ops' AND table_name = 'sales_master'
       AND column_name = 'job_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'ops' AND table_name = 'sales_master'
       AND column_name = 'salon_job_id'
  ) THEN
    ALTER TABLE ops.sales_master RENAME COLUMN job_id TO salon_job_id;
  END IF;
END $$;

ALTER INDEX IF EXISTS ops.ix_sales_master_job RENAME TO ix_sales_master_salon_job;

COMMIT;
