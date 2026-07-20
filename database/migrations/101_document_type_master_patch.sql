-- 101: patch hr.document_type_master for legacy-shaped tables
-- Prod + local tables predate migration 091's CREATE TABLE IF NOT EXISTS,
-- so 091 was skipped and these columns were never added.
-- Applied manually to prod (74.162.56.239:5433) and local on 2026-07-15.

ALTER TABLE hr.document_type_master
  ADD COLUMN IF NOT EXISTS is_required   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reminder_days INTEGER NOT NULL DEFAULT 30;
