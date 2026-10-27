-- Branch location type: client runs "1 back storage + N shops". Stock is already
-- per branch (core.product_inventory.branch_id); this flag only says what kind of
-- location a branch is so stock transfer / reports can tell STORE from SHOP.
-- Kept separate from branch_type (GENERAL / COUNTER_POS / ... business type).
-- Re-runnable.
BEGIN;

ALTER TABLE core.branch_master
  ADD COLUMN IF NOT EXISTS location_type VARCHAR(10) NOT NULL DEFAULT 'SHOP';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_branch_master_location_type'
       AND conrelid = 'core.branch_master'::regclass
  ) THEN
    ALTER TABLE core.branch_master
      ADD CONSTRAINT ck_branch_master_location_type
      CHECK (location_type IN ('STORE', 'SHOP'));
  END IF;
END $$;

COMMIT;
