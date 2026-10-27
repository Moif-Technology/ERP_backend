DROP INDEX IF EXISTS ops.uq_ops_sales_master_company_client_uuid;

ALTER TABLE ops.sales_master
  DROP COLUMN IF EXISTS offline_bill_no,
  DROP COLUMN IF EXISTS client_uuid;
