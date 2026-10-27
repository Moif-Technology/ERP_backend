-- 138_pos_offline_sync.sql
-- Counter-POS offline billing + autosync.
--   ops.sales_master.client_uuid     : id generated on the terminal for every bill save.
--                                      A retried / synced upload with the same id returns
--                                      the existing bill instead of inserting a duplicate.
--   ops.sales_master.offline_bill_no : number printed on the receipt while offline
--                                      (e.g. S3-OFF-12); NULL for bills saved online.
-- bill_no / sales_id are still assigned by the server when the bill reaches it.

ALTER TABLE ops.sales_master
  ADD COLUMN IF NOT EXISTS client_uuid     VARCHAR(64),
  ADD COLUMN IF NOT EXISTS offline_bill_no VARCHAR(40);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_sales_master_company_client_uuid
  ON ops.sales_master (company_id, client_uuid)
  WHERE client_uuid IS NOT NULL;
