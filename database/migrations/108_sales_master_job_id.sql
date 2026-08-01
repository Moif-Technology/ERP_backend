-- 108_sales_master_job_id.sql
-- Rename ops.sales_master.salon_job_id → job_id (user rename).
-- Idempotent for DBs that already have job_id.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'ops' AND table_name = 'sales_master'
       AND column_name = 'salon_job_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'ops' AND table_name = 'sales_master'
       AND column_name = 'job_id'
  ) THEN
    ALTER TABLE ops.sales_master RENAME COLUMN salon_job_id TO job_id;
  END IF;
END $$;

-- Prefer new constraint / index names when the old ones still exist.
ALTER TABLE ops.sales_master DROP CONSTRAINT IF EXISTS fk_sales_master_salon_job;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_sales_master_job'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'ops' AND table_name = 'sales_master'
       AND column_name = 'job_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'ops' AND table_name = 'job_master'
  ) THEN
    -- Only re-add FK when job rows still exist to reference; after settle-delete
    -- this may stay absent (migration 106 drops it on purpose).
    -- Skip re-creating FK here — settlement deletes jobs and needs no FK.
    NULL;
  END IF;
END $$;

ALTER INDEX IF EXISTS ops.ix_sales_master_salon_job RENAME TO ix_sales_master_job;

CREATE INDEX IF NOT EXISTS ix_sales_master_job
  ON ops.sales_master (company_id, job_id)
  WHERE job_id IS NOT NULL;

COMMIT;
