DROP INDEX IF EXISTS ops.pos_printer_one_default_uq;
ALTER TABLE ops.pos_printer DROP COLUMN IF EXISTS is_default;
