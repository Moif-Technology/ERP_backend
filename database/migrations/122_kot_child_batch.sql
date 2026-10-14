-- Legacy KOTChild.BatchNo / BatchPrintStatus (Mainfrm.btnLine / BatchCreation).
-- 0 = not yet assigned to a course. Print status 0 = not fired, 1 = printed.
ALTER TABLE ops.kot_child
  ADD COLUMN IF NOT EXISTS batch_no INTEGER NOT NULL DEFAULT 0;

ALTER TABLE ops.kot_child
  ADD COLUMN IF NOT EXISTS batch_print_status INTEGER NOT NULL DEFAULT 0;
