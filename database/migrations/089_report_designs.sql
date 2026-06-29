-- Report designs: persisted per company × branch × report_key.
-- branch_id NULL = company-level default (fallback when no branch-specific design exists).
-- Lookup order: branch-specific → company default → null (blank canvas).

CREATE TABLE IF NOT EXISTS core.report_designs (
  id          SERIAL       PRIMARY KEY,
  company_id  INTEGER      NOT NULL,
  branch_id   INTEGER      NULL,
  report_key  VARCHAR(100) NOT NULL,
  design_json JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_report_designs UNIQUE (company_id, branch_id, report_key)
);

CREATE INDEX IF NOT EXISTS idx_report_designs_lookup
  ON core.report_designs (company_id, report_key, branch_id);
