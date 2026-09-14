-- Kitchen-message / line-modifier presets (legacy SQL Server ModifierTable).
-- Branch-scoped like group_master. Source ModifierID is kept; a duplicate id
-- in MoifCore (id 7 used twice) is allowed by including modifier text in the unique key.

BEGIN;

CREATE TABLE IF NOT EXISTS biz.modifier_master (
  id                 BIGSERIAL     PRIMARY KEY,
  company_id         INTEGER       NOT NULL,
  branch_id          INTEGER       NOT NULL,
  modifier_id        INTEGER       NOT NULL,
  modifier           VARCHAR(150)  NOT NULL DEFAULT '',
  modifier_arabic    VARCHAR(200)  NOT NULL DEFAULT '',
  upload_status      VARCHAR(50)   NOT NULL DEFAULT '',
  r_status           VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE',
  is_deleted         BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  modified_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_biz_modifier_master_branch_src
    UNIQUE (company_id, branch_id, modifier_id, modifier)
);

CREATE INDEX IF NOT EXISTS idx_biz_modifier_master_company_branch
  ON biz.modifier_master (company_id, branch_id)
  WHERE COALESCE(is_deleted, FALSE) = FALSE;

COMMIT;
