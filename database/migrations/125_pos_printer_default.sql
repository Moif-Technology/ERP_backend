-- Default printer per station: receives settlement bills, dummy bills and
-- reports (everything the POS sends to "the default printer").
-- Additive only. Rollback: 125_pos_printer_default.down.sql

ALTER TABLE ops.pos_printer
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

-- At most one active default printer per station.
CREATE UNIQUE INDEX IF NOT EXISTS pos_printer_one_default_uq
  ON ops.pos_printer (company_id, station_id)
  WHERE is_default AND is_active;
