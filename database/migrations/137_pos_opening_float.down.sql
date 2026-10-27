ALTER TABLE ops.counter_close
  DROP COLUMN IF EXISTS petty_cash_out,
  DROP COLUMN IF EXISTS petty_cash_in,
  DROP COLUMN IF EXISTS opening_float;

ALTER TABLE ops.cash_in_out
  DROP COLUMN IF EXISTS category;
