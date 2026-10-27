-- 137_pos_opening_float.sql
-- Counter-POS cash drawer categories.
--   ops.cash_in_out.category: GENERAL | OPENING_FLOAT | PETTY_CASH | EXPENSE
--     OPENING_FLOAT is always a CASH_IN (float placed in the drawer at shift start).
--     Petty cash used to live only in the remarks text ("Petty Cash — ...").
--   ops.counter_close stores the float and petty cash of each Z close so the
--   expected-cash line can be re-printed:
--     expected = opening float + cash sales - cash refunds + cash in - cash out

ALTER TABLE ops.cash_in_out
  ADD COLUMN IF NOT EXISTS category VARCHAR(30) NOT NULL DEFAULT 'GENERAL';

-- Backfill: entries saved by the POS modal as "<Category> — <description>".
UPDATE ops.cash_in_out
   SET category = 'PETTY_CASH'
 WHERE category = 'GENERAL'
   AND remarks ILIKE 'Petty Cash%';

UPDATE ops.cash_in_out
   SET category = 'EXPENSE'
 WHERE category = 'GENERAL'
   AND remarks ILIKE 'Expense From Cash Counter%';

ALTER TABLE ops.counter_close
  ADD COLUMN IF NOT EXISTS opening_float  NUMERIC(18,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS petty_cash_in  NUMERIC(18,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS petty_cash_out NUMERIC(18,3) NOT NULL DEFAULT 0;
