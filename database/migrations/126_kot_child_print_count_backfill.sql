-- KOT "printed" marker moves from batch_print_status (legacy course firing,
-- Mainfrm.btnLine) to print_count (0 = never sent to kitchen, +1 per dispatch).
-- Carry over lines the KOT printer already marked, so they don't print again.
-- Re-run safe: only touches rows still at print_count = 0.
UPDATE ops.kot_child
   SET print_count = 1
 WHERE batch_print_status = 1
   AND COALESCE(print_count, 0) = 0;
