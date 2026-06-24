-- CrBy / ModBy as user display name (VARCHAR), aligned with migration 074 / 086.

ALTER TABLE accounts.transaction_expense_detail
  ALTER COLUMN created_by TYPE VARCHAR(50)
  USING (CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END);

ALTER TABLE accounts.transaction_expense_detail
  ALTER COLUMN modified_by TYPE VARCHAR(50)
  USING (CASE WHEN modified_by IS NULL THEN NULL ELSE modified_by::text END);
