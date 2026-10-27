-- Stock transfer between branches (ops.transfer_master / ops.transfer_detail).
-- The tables already exist in the base schema; CREATE ... IF NOT EXISTS only
-- covers databases built without them. Then add the audit columns the
-- /api/stock-transfers module writes. Re-runnable.
BEGIN;

CREATE TABLE IF NOT EXISTS ops.transfer_master (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    branch_id BIGINT NOT NULL,
    transfer_id BIGINT NOT NULL,
    transfer_no VARCHAR(20) NOT NULL,
    transfer_no_numeric NUMERIC(18,0),
    transfer_from_branch_id BIGINT NOT NULL,
    transfer_to_branch_id BIGINT NOT NULL,
    transfer_date TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    request_id BIGINT,
    request_no VARCHAR(50),
    total_amount NUMERIC(18,2) DEFAULT 0.00 NOT NULL,
    remarks VARCHAR(250),
    post_status VARCHAR(20) DEFAULT 'DRAFT' NOT NULL,
    record_status VARCHAR(10) DEFAULT 'A' NOT NULL,
    transfer_status VARCHAR(20) DEFAULT 'OPEN' NOT NULL,
    sync_status VARCHAR(30) DEFAULT 'pending' NOT NULL,
    server_status VARCHAR(50),
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by VARCHAR(50),
    modified_at TIMESTAMP WITHOUT TIME ZONE,
    modified_by VARCHAR(50),
    CONSTRAINT ck_transfer_master_from_to_diff CHECK (transfer_from_branch_id <> transfer_to_branch_id),
    CONSTRAINT ck_transfer_master_post_status CHECK (post_status IN ('DRAFT','POSTED','CANCELLED','APPROVED','PENDING')),
    CONSTRAINT ck_transfer_master_total_amount CHECK (total_amount >= 0),
    CONSTRAINT ck_transfer_master_transfer_status CHECK (transfer_status IN ('OPEN','IN_TRANSIT','RECEIVED','CANCELLED','CLOSED')),
    CONSTRAINT uq_transfer_master_transfer_id UNIQUE (company_id, branch_id, transfer_id),
    CONSTRAINT uq_transfer_master_transfer_no UNIQUE (company_id, branch_id, transfer_no)
);

CREATE TABLE IF NOT EXISTS ops.transfer_detail (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    branch_id BIGINT NOT NULL,
    transfer_detail_id BIGINT NOT NULL,
    transfer_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    qty NUMERIC(18,3) DEFAULT 0 NOT NULL,
    pack_qty NUMERIC(18,3) DEFAULT 0 NOT NULL,
    unique_multi_product_id BIGINT,
    average_cost NUMERIC(18,2) DEFAULT 0.00 NOT NULL,
    unit_price NUMERIC(18,2) DEFAULT 0.00 NOT NULL,
    line_total NUMERIC(18,2) DEFAULT 0.00 NOT NULL,
    post_status VARCHAR(20) DEFAULT 'DRAFT' NOT NULL,
    sync_status VARCHAR(30) DEFAULT 'pending' NOT NULL,
    record_status VARCHAR(10) DEFAULT 'A' NOT NULL,
    server_status VARCHAR(50),
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by VARCHAR(50),
    modified_at TIMESTAMP WITHOUT TIME ZONE,
    modified_by VARCHAR(50),
    CONSTRAINT uq_transfer_detail_id UNIQUE (company_id, branch_id, transfer_detail_id),
    CONSTRAINT fk_transfer_detail_master FOREIGN KEY (company_id, branch_id, transfer_id)
      REFERENCES ops.transfer_master (company_id, branch_id, transfer_id)
);

ALTER TABLE ops.transfer_master
  ADD COLUMN IF NOT EXISTS posted_at     TIMESTAMP WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS posted_by     VARCHAR(50),
  ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMP WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS cancelled_by  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS cancel_reason VARCHAR(250);

ALTER TABLE ops.transfer_detail
  ADD COLUMN IF NOT EXISTS line_notes VARCHAR(250);

CREATE INDEX IF NOT EXISTS idx_transfer_master_company_from
  ON ops.transfer_master (company_id, transfer_from_branch_id);
CREATE INDEX IF NOT EXISTS idx_transfer_master_company_to
  ON ops.transfer_master (company_id, transfer_to_branch_id);
CREATE INDEX IF NOT EXISTS idx_transfer_detail_company_branch_transfer
  ON ops.transfer_detail (company_id, branch_id, transfer_id);

COMMIT;
