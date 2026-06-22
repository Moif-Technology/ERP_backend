-- CrBy / ModBy store user display name (legacy VARCHAR), not staff id.

ALTER TABLE biz.supplier_master
  ALTER COLUMN created_by TYPE VARCHAR(50)
  USING (CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END);

ALTER TABLE biz.supplier_master
  ALTER COLUMN modified_by TYPE VARCHAR(50)
  USING (CASE WHEN modified_by IS NULL THEN NULL ELSE modified_by::text END);

ALTER TABLE ops.purchase_master
  ALTER COLUMN created_by TYPE VARCHAR(50)
  USING (CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END);

ALTER TABLE ops.purchase_master
  ALTER COLUMN modified_by TYPE VARCHAR(50)
  USING (CASE WHEN modified_by IS NULL THEN NULL ELSE modified_by::text END);

ALTER TABLE ops.purchase_child
  ALTER COLUMN created_by TYPE VARCHAR(50)
  USING (CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END);

ALTER TABLE ops.purchase_child
  ALTER COLUMN modified_by TYPE VARCHAR(50)
  USING (CASE WHEN modified_by IS NULL THEN NULL ELSE modified_by::text END);

ALTER TABLE accounts.voucher_master
  ALTER COLUMN created_by TYPE VARCHAR(50)
  USING (CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END);

ALTER TABLE accounts.voucher_master
  ALTER COLUMN modified_by TYPE VARCHAR(50)
  USING (CASE WHEN modified_by IS NULL THEN NULL ELSE modified_by::text END);

ALTER TABLE accounts.voucher_detail
  ALTER COLUMN created_by TYPE VARCHAR(50)
  USING (CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END);

ALTER TABLE accounts.voucher_detail
  ALTER COLUMN modified_by TYPE VARCHAR(50)
  USING (CASE WHEN modified_by IS NULL THEN NULL ELSE modified_by::text END);
