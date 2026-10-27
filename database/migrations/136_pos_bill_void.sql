-- 136_pos_bill_void.sql
-- Counter-POS bill cancellation (void full posted bill / void one item of a posted bill).
--   * sales_master gets audit fields; a voided bill keeps its row with
--     post_status = 'CANCELLED' so every POSTED-only report drops it.
--   * ops.sales_void_log keeps one row per void action (BILL or ITEM) — the source
--     for the Z/X report BILL CANCELLED / ITEM CANCELLED lines. A voided item's
--     sales_child row is removed from the bill, so its details live here.
--   * counter_close stores the cancelled counts/values of each Z close.
-- Only bills still PENDING counter close can be voided (enforced in the API).

ALTER TABLE ops.sales_master
  ADD COLUMN IF NOT EXISTS void_by     VARCHAR(50),
  ADD COLUMN IF NOT EXISTS void_at     TIMESTAMP WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS void_reason VARCHAR(200);

CREATE TABLE IF NOT EXISTS ops.sales_void_log (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT        NOT NULL,
  branch_id            BIGINT,
  station_id           BIGINT,
  counter_no           INTEGER,
  sales_id             BIGINT        NOT NULL,
  bill_staff_id        BIGINT,
  void_type            VARCHAR(10)   NOT NULL CHECK (void_type IN ('BILL', 'ITEM')),
  sales_child_id       BIGINT,
  product_id           BIGINT,
  product_code         VARCHAR(50),
  description          VARCHAR(100),
  qty                  NUMERIC(18,3),
  unit_price           NUMERIC(18,3),
  line_total           NUMERIC(18,2),
  amount               NUMERIC(18,2) NOT NULL DEFAULT 0,
  payment_mode         VARCHAR(50),
  void_reason          VARCHAR(200)  NOT NULL,
  void_by              VARCHAR(50),
  void_by_staff_id     BIGINT,
  void_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  counter_close_status VARCHAR(50)   NOT NULL DEFAULT 'PENDING'
);

CREATE INDEX IF NOT EXISTS ix_sales_void_log_pending
  ON ops.sales_void_log (company_id, station_id, counter_no, counter_close_status);
CREATE INDEX IF NOT EXISTS ix_sales_void_log_sales
  ON ops.sales_void_log (company_id, sales_id);

ALTER TABLE ops.counter_close
  ADD COLUMN IF NOT EXISTS bill_cancelled_count  INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bill_cancelled_amount NUMERIC(18,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS item_cancelled_count  INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS item_cancelled_amount NUMERIC(18,3) NOT NULL DEFAULT 0;
