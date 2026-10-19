-- KOT ids are allocated per company (kotRepo.nextKotMasterId / nextKotChildId use
-- MAX+1 WHERE company_id = $1), but prod had them unique across ALL companies:
--   uq_kot_master_kot_master_id UNIQUE (kot_master_id)
--   kot_child_pkey              PRIMARY KEY (kot_child_id)
--   fk_kot_child_kot_master     (kot_master_id) -> kot_master(kot_master_id)
-- so the first KOT of any new tenant (e.g. Falaknumar, co 9) collided with co 1's id 1:
--   duplicate key value violates unique constraint "uq_kot_master_kot_master_id"
-- Scope all three by company_id, matching database/migrations/016 (root tree).
-- Re-runnable: every constraint is dropped by name before being added.
BEGIN;

ALTER TABLE ops.kot_child  DROP CONSTRAINT IF EXISTS fk_kot_child_kot_master;
ALTER TABLE ops.kot_child  DROP CONSTRAINT IF EXISTS fk_ops_kot_child_master;
ALTER TABLE ops.kot_master DROP CONSTRAINT IF EXISTS uq_kot_master_kot_master_id;
ALTER TABLE ops.kot_master DROP CONSTRAINT IF EXISTS uq_ops_kot_master_company_kot_master_id;

ALTER TABLE ops.kot_master
  ADD CONSTRAINT uq_ops_kot_master_company_kot_master_id UNIQUE (company_id, kot_master_id);

ALTER TABLE ops.kot_child DROP CONSTRAINT IF EXISTS kot_child_pkey;
ALTER TABLE ops.kot_child
  ADD CONSTRAINT kot_child_pkey PRIMARY KEY (company_id, kot_child_id);

ALTER TABLE ops.kot_child
  ADD CONSTRAINT fk_ops_kot_child_master FOREIGN KEY (company_id, kot_master_id)
  REFERENCES ops.kot_master (company_id, kot_master_id) ON DELETE CASCADE;

COMMIT;
