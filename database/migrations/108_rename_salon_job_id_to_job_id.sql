-- 108_rename_salon_job_id_to_job_id.sql
-- Rename salon_job_id → job_id in sales_master for multi-use (salon + laundry)

BEGIN;

-- Drop old constraint and index
ALTER TABLE ops.sales_master
  DROP CONSTRAINT fk_sales_master_salon_job;

DROP INDEX IF EXISTS ix_sales_master_salon_job;

-- Rename column
ALTER TABLE ops.sales_master
  RENAME COLUMN salon_job_id TO job_id;

-- Recreate foreign key with new name
ALTER TABLE ops.sales_master
  ADD CONSTRAINT fk_sales_master_job
  FOREIGN KEY (company_id, job_id)
  REFERENCES ops.job_master (company_id, job_id);

-- Recreate index
CREATE INDEX ix_sales_master_job
  ON ops.sales_master (company_id, job_id)
  WHERE job_id IS NOT NULL;

COMMIT;
