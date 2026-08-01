-- 107_rename_salon_job_tables.sql
-- Rename ops.salon_job_master / ops.salon_job_child to ops.job_master / ops.job_child.
-- Idempotent: no-op when the new names already exist.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'ops' AND table_name = 'salon_job_master'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'ops' AND table_name = 'job_master'
  ) THEN
    ALTER TABLE ops.salon_job_master RENAME TO job_master;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'ops' AND table_name = 'salon_job_child'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'ops' AND table_name = 'job_child'
  ) THEN
    ALTER TABLE ops.salon_job_child RENAME TO job_child;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_salon_job_master_company_job') THEN
    ALTER TABLE ops.job_master RENAME CONSTRAINT uq_salon_job_master_company_job TO uq_job_master_company_job;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_salon_job_status') THEN
    ALTER TABLE ops.job_master RENAME CONSTRAINT chk_salon_job_status TO chk_job_status;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_salon_job_child_company_job_line') THEN
    ALTER TABLE ops.job_child RENAME CONSTRAINT uq_salon_job_child_company_job_line TO uq_job_child_company_job_line;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_salon_job_child_master') THEN
    ALTER TABLE ops.job_child RENAME CONSTRAINT fk_salon_job_child_master TO fk_job_child_master;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_salon_job_master_sales') THEN
    ALTER TABLE ops.job_master RENAME CONSTRAINT fk_salon_job_master_sales TO fk_job_master_sales;
  END IF;
END $$;

ALTER INDEX IF EXISTS ops.idx_salon_job_master_open RENAME TO idx_job_master_open;
ALTER INDEX IF EXISTS ops.idx_salon_job_master_chair RENAME TO idx_job_master_chair;
ALTER INDEX IF EXISTS ops.idx_salon_job_child_job RENAME TO idx_job_child_job;
ALTER INDEX IF EXISTS ops.idx_salon_job_child_stylist RENAME TO idx_job_child_stylist;
ALTER INDEX IF EXISTS ops.uq_salon_job_master_sales RENAME TO uq_job_master_sales;
ALTER INDEX IF EXISTS ops.uq_salon_open_job_per_chair RENAME TO uq_open_job_per_chair;

COMMIT;
