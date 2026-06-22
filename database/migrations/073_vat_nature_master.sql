-- Standard VAT nature-of-transaction master (legacy VATNatureTable).
-- Safe to re-run: CREATE IF NOT EXISTS + unique keys for upsert.

CREATE TABLE IF NOT EXISTS accounts.vat_nature_master (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT       NOT NULL,
  vat_nature_id   BIGINT       NOT NULL,
  vat_nature_name VARCHAR(100) NOT NULL,
  vat_nature_type VARCHAR(50),
  record_status   VARCHAR(10)  NOT NULL DEFAULT 'ACTIVE',
  created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
  created_by      VARCHAR(50),
  modified_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
  modified_by     VARCHAR(50),
  CONSTRAINT uq_accounts_vat_nature_master_company_vat_nature_id
    UNIQUE (company_id, vat_nature_id),
  CONSTRAINT uq_accounts_vat_nature_master_company_vat_nature_name
    UNIQUE (company_id, vat_nature_name)
);

CREATE INDEX IF NOT EXISTS idx_accounts_vat_nature_master_company_id
  ON accounts.vat_nature_master (company_id);

CREATE INDEX IF NOT EXISTS idx_accounts_vat_nature_master_company_type
  ON accounts.vat_nature_master (company_id, vat_nature_type);

CREATE INDEX IF NOT EXISTS idx_accounts_vat_nature_master_company_record_status
  ON accounts.vat_nature_master (company_id, record_status);
