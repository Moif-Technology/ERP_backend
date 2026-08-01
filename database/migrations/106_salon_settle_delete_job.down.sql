-- 106_salon_settle_delete_job.down.sql
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_master_sales
  ON ops.job_master (company_id, sales_id)
  WHERE sales_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_job_master_sales'
  ) THEN
    ALTER TABLE ops.job_master
      ADD CONSTRAINT fk_job_master_sales
      FOREIGN KEY (company_id, sales_id)
      REFERENCES ops.sales_master (company_id, sales_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_sales_master_job'
  ) THEN
    ALTER TABLE ops.sales_master
      ADD CONSTRAINT fk_sales_master_job
      FOREIGN KEY (company_id, job_id)
      REFERENCES ops.job_master (company_id, job_id);
  END IF;
END $$;

COMMIT;
