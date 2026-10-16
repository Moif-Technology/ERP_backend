-- Sale-time recipe consumption (legacy RecipeTransaction).
-- Matches the live ops.recipe_transaction shape: staff ids on created_by /
-- modified_by, sales line refs required, soft-delete columns present.
-- recipe_transaction_id is an internal row id, not a printed document number.
-- No-op when the table was already created by the base schema.

BEGIN;

CREATE TABLE IF NOT EXISTS ops.recipe_transaction (
  id                     BIGSERIAL       PRIMARY KEY,
  company_id             BIGINT          NOT NULL,
  recipe_transaction_id  BIGINT          NOT NULL,
  branch_id              BIGINT          NOT NULL,
  sales_id               BIGINT          NOT NULL,
  sales_child_id         BIGINT          NOT NULL,
  finished_product_id    BIGINT          NOT NULL,
  finished_unique_id     BIGINT          NULL,
  recipe_product_id      BIGINT          NOT NULL,
  recipe_unique_id       BIGINT          NULL,
  recipe_qty             NUMERIC(18,10)  NOT NULL DEFAULT 0,
  pack_qty               NUMERIC(18,3)   NOT NULL DEFAULT 1,
  created_at             TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by             BIGINT          NULL,
  modified_at            TIMESTAMPTZ     NULL,
  modified_by            BIGINT          NULL,
  server_status          VARCHAR(50)     NULL,
  deleted_at             TIMESTAMPTZ     NULL,
  deleted_by             BIGINT          NULL,
  is_deleted             BOOLEAN         NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_ops_recipe_transaction_company_recipe_transaction_id
    UNIQUE (company_id, recipe_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_ops_recipe_transaction_company_branch
  ON ops.recipe_transaction (company_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_ops_recipe_transaction_company_sales_id
  ON ops.recipe_transaction (company_id, sales_id);

CREATE INDEX IF NOT EXISTS idx_ops_recipe_transaction_company_sales_child_id
  ON ops.recipe_transaction (company_id, sales_child_id);

CREATE INDEX IF NOT EXISTS idx_ops_recipe_transaction_company_finished_product_id
  ON ops.recipe_transaction (company_id, finished_product_id);

CREATE INDEX IF NOT EXISTS idx_ops_recipe_transaction_company_recipe_product_id
  ON ops.recipe_transaction (company_id, recipe_product_id);

CREATE INDEX IF NOT EXISTS idx_ops_recipe_transaction_company_branch_finished_product
  ON ops.recipe_transaction (company_id, branch_id, finished_product_id);

COMMIT;
