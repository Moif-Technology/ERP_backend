ALTER TABLE core.branch_master DROP CONSTRAINT IF EXISTS ck_branch_master_location_type;
ALTER TABLE core.branch_master DROP COLUMN IF EXISTS location_type;
