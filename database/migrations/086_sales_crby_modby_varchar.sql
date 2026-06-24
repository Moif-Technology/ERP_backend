-- Extend 074: ops sales + stock log CrBy/ModBy store user display name (VARCHAR), not staff id.

ALTER TABLE ops.sales_master
  ALTER COLUMN created_by TYPE VARCHAR(50)
  USING (CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END);

ALTER TABLE ops.sales_master
  ALTER COLUMN modified_by TYPE VARCHAR(50)
  USING (CASE WHEN modified_by IS NULL THEN NULL ELSE modified_by::text END);

ALTER TABLE ops.sales_child
  ALTER COLUMN created_by TYPE VARCHAR(50)
  USING (CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END);

ALTER TABLE ops.sales_child
  ALTER COLUMN modified_by TYPE VARCHAR(50)
  USING (CASE WHEN modified_by IS NULL THEN NULL ELSE modified_by::text END);

ALTER TABLE ops.product_log_entry
  ALTER COLUMN created_by TYPE VARCHAR(50)
  USING (CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END);

ALTER TABLE ops.product_log_entry
  ALTER COLUMN modified_by TYPE VARCHAR(50)
  USING (CASE WHEN modified_by IS NULL THEN NULL ELSE modified_by::text END);
