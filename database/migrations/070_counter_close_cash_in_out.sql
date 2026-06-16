-- Counter close snapshot + session cash in/out (Counter-POS Z Report)
CREATE TABLE IF NOT EXISTS ops.counter_close (
  id                    BIGSERIAL PRIMARY KEY,
  company_id            BIGINT NOT NULL,
  branch_id             BIGINT NOT NULL,
  counter_no            INTEGER NOT NULL DEFAULT 1,
  staff_id              BIGINT NOT NULL,
  report_type           VARCHAR(5) NOT NULL DEFAULT 'Z',
  close_date            TIMESTAMP NOT NULL DEFAULT NOW(),
  total_cash            NUMERIC(18,3) NOT NULL DEFAULT 0,
  total_credit          NUMERIC(18,3) NOT NULL DEFAULT 0,
  total_card            NUMERIC(18,3) NOT NULL DEFAULT 0,
  total_discount        NUMERIC(18,3) NOT NULL DEFAULT 0,
  total_refund          NUMERIC(18,3) NOT NULL DEFAULT 0,
  total_round_off       NUMERIC(18,3) NOT NULL DEFAULT 0,
  total_tax             NUMERIC(18,3) NOT NULL DEFAULT 0,
  gross_amount          NUMERIC(18,3) NOT NULL DEFAULT 0,
  cash_in               NUMERIC(18,3) NOT NULL DEFAULT 0,
  cash_out              NUMERIC(18,3) NOT NULL DEFAULT 0,
  cash_to_be_collected  NUMERIC(18,3) NOT NULL DEFAULT 0,
  collected_cash        NUMERIC(18,3) NOT NULL DEFAULT 0,
  cash_difference       NUMERIC(18,3) NOT NULL DEFAULT 0,
  bill_count            INTEGER NOT NULL DEFAULT 0,
  start_bill_no         BIGINT,
  end_bill_no           BIGINT,
  close_no              VARCHAR(30),
  created_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ops.cash_in_out (
  id                 BIGSERIAL PRIMARY KEY,
  company_id         BIGINT NOT NULL,
  branch_id          BIGINT NOT NULL,
  counter_no         INTEGER NOT NULL DEFAULT 1,
  staff_id           BIGINT NOT NULL,
  transaction_type   VARCHAR(20) NOT NULL,
  amount             NUMERIC(18,3) NOT NULL,
  remarks            TEXT,
  close_status       VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  counter_close_id   BIGINT,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_in_out_session
  ON ops.cash_in_out (company_id, branch_id, counter_no, staff_id, close_status);

CREATE INDEX IF NOT EXISTS idx_cash_in_out_close
  ON ops.cash_in_out (company_id, counter_close_id);

ALTER TABLE ops.sales_master
  ADD COLUMN IF NOT EXISTS counter_close_status VARCHAR(50) NOT NULL DEFAULT 'PENDING';
