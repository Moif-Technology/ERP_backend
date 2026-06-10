-- Company Profile columns migration
-- Run once against your PostgreSQL database

ALTER TABLE core.company_master
  ADD COLUMN IF NOT EXISTS email          TEXT,
  ADD COLUMN IF NOT EXISTS website        TEXT,
  ADD COLUMN IF NOT EXISTS vat_trn        TEXT,
  ADD COLUMN IF NOT EXISTS trade_license  TEXT,
  ADD COLUMN IF NOT EXISTS po_box         TEXT,
  ADD COLUMN IF NOT EXISTS city           TEXT,
  ADD COLUMN IF NOT EXISTS country        TEXT,
  ADD COLUMN IF NOT EXISTS logo_data      TEXT,
  ADD COLUMN IF NOT EXISTS currency       TEXT        DEFAULT 'AED',
  ADD COLUMN IF NOT EXISTS fiscal_year_start TEXT     DEFAULT '01-01',
  ADD COLUMN IF NOT EXISTS decimal_places INTEGER     DEFAULT 2;
