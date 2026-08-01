-- 107_rename_salon_job_tables.down.sql
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'ops' AND table_name = 'job_master'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'ops' AND table_name = 'salon_job_master'
  ) THEN
    ALTER TABLE ops.job_master RENAME TO salon_job_master;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'ops' AND table_name = 'job_child'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'ops' AND table_name = 'salon_job_child'
  ) THEN
    ALTER TABLE ops.job_child RENAME TO salon_job_child;
  END IF;
END $$;

COMMIT;
