-- 105_salon_settlement.sql
--
-- Links a settled salon bill back to the job it came from, so the salon
-- settlement endpoint has somewhere to record the relationship.
--
-- Restaurant POS already does this with ops.sales_master.kot_master_id +
-- ops.kot_master.bill_id. Salon needs the same pair of pointers, but its jobs
-- live in ops.salon_job_master, and kot_master_id must NOT be reused for them:
-- reports and the KOT screens read kot_master_id as a kot_master reference, and
-- a salon job id would collide with an unrelated KOT id in the same company.
--
-- Both foreign keys are composite (company_id, <id>) because every id in this
-- schema is allocated per company — a bare job_id or sales_id is ambiguous
-- across tenants.
--
-- The two tables now reference each other. That is safe without deferrable
-- constraints given the write order the service uses:
--   1. INSERT sales_master  (salon_job_id -> a job row that already exists)
--   2. UPDATE salon_job_master SET sales_id -> the row just inserted in step 1
-- Neither statement can see a dangling target.

BEGIN;

-- 1. Bill -> job.
ALTER TABLE ops.sales_master
  ADD COLUMN IF NOT EXISTS salon_job_id BIGINT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_sales_master_salon_job'
  ) THEN
    ALTER TABLE ops.sales_master
      ADD CONSTRAINT fk_sales_master_salon_job
      FOREIGN KEY (company_id, salon_job_id)
      REFERENCES ops.salon_job_master (company_id, job_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_sales_master_salon_job
  ON ops.sales_master (company_id, salon_job_id)
  WHERE salon_job_id IS NOT NULL;

-- 2. Job -> bill. Mirrors ops.kot_master.bill_id: it is what the settlement
--    guard checks to refuse billing the same job twice.
ALTER TABLE ops.salon_job_master
  ADD COLUMN IF NOT EXISTS sales_id BIGINT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_salon_job_master_sales'
  ) THEN
    ALTER TABLE ops.salon_job_master
      ADD CONSTRAINT fk_salon_job_master_sales
      FOREIGN KEY (company_id, sales_id)
      REFERENCES ops.sales_master (company_id, sales_id);
  END IF;
END $$;

-- One job may only ever produce one bill. A partial unique index rather than a
-- constraint so the many NULLs (open jobs) do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS uq_salon_job_master_sales
  ON ops.salon_job_master (company_id, sales_id)
  WHERE sales_id IS NOT NULL;

-- 3. line_type on sales_child was added by 104 without a domain check. The
--    salon writes 'SERVICE' or 'PRODUCT'; restaurant and counter POS leave it
--    NULL. Constrain the values that are allowed so a typo cannot land silently
--    and break commission reporting later.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_sales_child_line_type'
  ) THEN
    ALTER TABLE ops.sales_child
      ADD CONSTRAINT chk_sales_child_line_type
      CHECK (line_type IS NULL OR line_type IN ('PRODUCT', 'SERVICE'));
  END IF;
END $$;

-- 4. Commission/stylist reporting reads sales_child by stylist. Without this
--    every such report is a full scan of the company's sales lines.
CREATE INDEX IF NOT EXISTS ix_sales_child_stylist
  ON ops.sales_child (company_id, stylist_id)
  WHERE stylist_id IS NOT NULL;

COMMIT;
