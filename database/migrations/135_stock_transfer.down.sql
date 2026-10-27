-- Only drops what 135 added; the base-schema tables are left in place.
DROP INDEX IF EXISTS ops.idx_transfer_master_company_from;
DROP INDEX IF EXISTS ops.idx_transfer_master_company_to;
ALTER TABLE ops.transfer_detail DROP COLUMN IF EXISTS line_notes;
ALTER TABLE ops.transfer_master
  DROP COLUMN IF EXISTS posted_at,
  DROP COLUMN IF EXISTS posted_by,
  DROP COLUMN IF EXISTS cancelled_at,
  DROP COLUMN IF EXISTS cancelled_by,
  DROP COLUMN IF EXISTS cancel_reason;
