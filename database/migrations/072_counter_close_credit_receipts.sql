-- Credit settlement receipts included in counter close snapshot
ALTER TABLE ops.counter_close
  ADD COLUMN IF NOT EXISTS credit_receipt_cash  NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_receipt_card  NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_receipt_count INTEGER NOT NULL DEFAULT 0;
