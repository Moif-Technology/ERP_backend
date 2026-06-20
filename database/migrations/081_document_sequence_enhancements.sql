-- Enhance core.document_sequence for per-company+branch sequential doc numbers.
-- Adds: pad_length, reset_rule, fiscal_year, fiscal_month.
-- Fixes: ops.purchase_master.purchase_no and ops.lpo_master.lpo_no to VARCHAR
--        so they can hold formatted strings like "PO-2026-0042".

-- ── 1. Add missing columns to core.document_sequence ──────────────────────────
ALTER TABLE core.document_sequence
  ADD COLUMN IF NOT EXISTS pad_length   INTEGER      NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS reset_rule   VARCHAR(20)  NOT NULL DEFAULT 'NEVER',
  ADD COLUMN IF NOT EXISTS fiscal_year  INTEGER      NULL,
  ADD COLUMN IF NOT EXISTS fiscal_month INTEGER      NULL;

-- ── 2. Drop old unique constraint (did not include fiscal scope) ──────────────
ALTER TABLE core.document_sequence
  DROP CONSTRAINT IF EXISTS uq_document_sequence_company_branch_code;

-- ── 3. New unique index includes fiscal scope ──────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_seq_scope
  ON core.document_sequence
  (company_id, branch_id, sequence_code,
   COALESCE(fiscal_year, 0), COALESCE(fiscal_month, 0));

-- ── 4. Fix purchase_no: NUMERIC → VARCHAR so it holds "PO-2026-0042" ──────────
ALTER TABLE ops.purchase_master
  ALTER COLUMN purchase_no TYPE VARCHAR(50) USING CAST(purchase_no AS VARCHAR);

-- ── 5. Fix lpo_no: BIGINT → VARCHAR ───────────────────────────────────────────
ALTER TABLE ops.lpo_master
  ALTER COLUMN lpo_no TYPE VARCHAR(50) USING CAST(lpo_no AS VARCHAR);
