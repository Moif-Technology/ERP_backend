-- Recipe / BOM lines (legacy RecipieDetails).
-- Matches the live core.recipe_detail shape: staff ids on created_by / modified_by,
-- soft-delete columns present, duplicate raw materials allowed (VB grid can add the same item twice).
-- recipe_detail_id is an internal line id, not a printed document number.

BEGIN;

CREATE TABLE IF NOT EXISTS core.recipe_detail (
  id                          BIGSERIAL       PRIMARY KEY,
  company_id                  BIGINT          NOT NULL,
  recipe_detail_id            BIGINT          NOT NULL,
  recipe_no                   BIGINT          NOT NULL DEFAULT 0,
  branch_id                   BIGINT          NOT NULL,
  finished_product_id         BIGINT          NOT NULL,
  finished_product_unique_id  BIGINT          NULL,
  raw_material_id             BIGINT          NOT NULL,
  raw_material_unique_id      BIGINT          NULL,
  recipe_qty                  NUMERIC(18,10)  NOT NULL DEFAULT 0,
  unit_name                   VARCHAR(50)     NULL,
  remarks                     VARCHAR(200)    NULL,
  raw_material_cost           NUMERIC(18,2)   NOT NULL DEFAULT 0,
  sync_status                 VARCHAR(50)     NOT NULL DEFAULT 'PENDING',
  server_status               VARCHAR(50)     NULL,
  record_status               VARCHAR(50)     NOT NULL DEFAULT 'ACTIVE',
  created_at                  TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by                  BIGINT          NULL,
  modified_at                 TIMESTAMPTZ     NULL DEFAULT CURRENT_TIMESTAMP,
  modified_by                 BIGINT          NULL,
  deleted_at                  TIMESTAMPTZ     NULL,
  deleted_by                  BIGINT          NULL,
  is_deleted                  BOOLEAN         NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_core_recipe_detail_company_recipe_detail_id
    UNIQUE (company_id, recipe_detail_id)
);

ALTER TABLE core.recipe_detail ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE core.recipe_detail ADD COLUMN IF NOT EXISTS deleted_by BIGINT;
ALTER TABLE core.recipe_detail ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_core_recipe_detail_company_branch
  ON core.recipe_detail (company_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_core_recipe_detail_company_finished_product_id
  ON core.recipe_detail (company_id, finished_product_id);

CREATE INDEX IF NOT EXISTS idx_core_recipe_detail_company_raw_material_id
  ON core.recipe_detail (company_id, raw_material_id);

CREATE INDEX IF NOT EXISTS idx_core_recipe_detail_company_branch_finished_product
  ON core.recipe_detail (company_id, branch_id, finished_product_id);

CREATE INDEX IF NOT EXISTS idx_core_recipe_detail_company_recipe_no
  ON core.recipe_detail (company_id, recipe_no);

CREATE INDEX IF NOT EXISTS idx_core_recipe_detail_company_record_status
  ON core.recipe_detail (company_id, record_status);

COMMIT;
