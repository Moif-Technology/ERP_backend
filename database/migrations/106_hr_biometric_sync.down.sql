-- 106_hr_biometric_sync.down.sql
--
-- Reverses 106_hr_biometric_sync.sql.
--
-- Dropping the staging table destroys every biometric row that was never
-- matched to an employee. Export it first if the PIN mapping is not finished:
--   \copy (SELECT * FROM hr.attendance_biometric_staging) TO 'staging.csv' CSV HEADER
--
-- Attendance rows already written into hr.attendance_daily survive; only their
-- provenance columns are removed.

BEGIN;

ALTER TABLE hr.attendance_daily DROP COLUMN IF EXISTS synced_at;
ALTER TABLE hr.attendance_daily DROP COLUMN IF EXISTS device_pin;
ALTER TABLE hr.attendance_daily DROP COLUMN IF EXISTS source;

DROP TABLE IF EXISTS hr.attendance_sync_job;
DROP TABLE IF EXISTS hr.attendance_biometric_staging;
DROP TABLE IF EXISTS hr.biometric_pin_map;
DROP TABLE IF EXISTS hr.biometric_device_token;

COMMIT;
