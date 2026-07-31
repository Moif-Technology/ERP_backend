-- 107_rename_salon_job_tables.sql
-- Rename salon_job_master to job_master and salon_job_child to job_child

ALTER TABLE ops.salon_job_master RENAME TO job_master;
ALTER TABLE ops.salon_job_child RENAME TO job_child;
