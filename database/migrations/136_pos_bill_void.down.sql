ALTER TABLE ops.counter_close
  DROP COLUMN IF EXISTS item_cancelled_amount,
  DROP COLUMN IF EXISTS item_cancelled_count,
  DROP COLUMN IF EXISTS bill_cancelled_amount,
  DROP COLUMN IF EXISTS bill_cancelled_count;

DROP TABLE IF EXISTS ops.sales_void_log;

ALTER TABLE ops.sales_master
  DROP COLUMN IF EXISTS void_reason,
  DROP COLUMN IF EXISTS void_at,
  DROP COLUMN IF EXISTS void_by;
