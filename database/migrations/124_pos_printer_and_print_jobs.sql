-- POS printer configuration + print-job lifecycle.
-- Additive only. Safe to run on an existing database; creates nothing that an
-- older build reads, so rolling back the app before running this is harmless.
--
-- Scope model: every row is keyed by (company_id, station_id). station_id is the
-- POS-scoped token's registered till (authStaff.station_id) — never a client-sent
-- tenant id. See api/src/pos/restaurant-pos/services/printer.service.js.

-- ── Printer configuration ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ops.pos_printer (
  printer_id    BIGSERIAL PRIMARY KEY,
  company_id    BIGINT       NOT NULL,
  station_id    BIGINT       NOT NULL,
  -- Routing bucket. Special legacy ids: 99 no-printer, 98 delivery, 97 duplicate,
  -- 96 takeaway. 0 = ordinary kitchen/counter printer routed by kitchen_loc.
  counter_no    INTEGER      NOT NULL DEFAULT 0,
  -- Matched (case-insensitive, trimmed) against core.product_inventory.location_code.
  kitchen_loc   TEXT         NOT NULL DEFAULT '',
  -- Windows deviceName, or a native target label for ESC/POS transports.
  printer_name  TEXT         NOT NULL DEFAULT '',
  -- default | windows | escpos_tcp | escpos_bt | escpos_usb | browser
  transport     TEXT         NOT NULL DEFAULT 'default',
  -- host:port for escpos_tcp, MAC for escpos_bt, else ''.
  address       TEXT         NOT NULL DEFAULT '',
  paper_mm      INTEGER      NOT NULL DEFAULT 80,     -- 58 or 80
  -- Explicit fallback when no kitchen_loc matches. Never a silent wrong-printer
  -- guess: at most one active fallback per station.
  is_fallback   BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by    BIGINT,
  modified_by   BIGINT,
  created_on    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  modified_on   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT pos_printer_paper_chk CHECK (paper_mm IN (58, 80)),
  CONSTRAINT pos_printer_station_counter_uq UNIQUE (company_id, station_id, counter_no)
);

-- One active fallback printer per station.
CREATE UNIQUE INDEX IF NOT EXISTS pos_printer_one_fallback_uq
  ON ops.pos_printer (company_id, station_id)
  WHERE is_fallback AND is_active;

-- ── Print-job lifecycle ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ops.print_job (
  print_job_id  BIGSERIAL PRIMARY KEY,
  company_id    BIGINT       NOT NULL,
  station_id    BIGINT       NOT NULL,
  -- KOT_NEW | KOT_DELTA | KOT_CANCEL | KOT_QTY | KOT_REPRINT | BILL | TEST
  job_type      TEXT         NOT NULL,
  kot_master_id BIGINT,
  printer_id    BIGINT       REFERENCES ops.pos_printer (printer_id) ON DELETE SET NULL,
  -- Duplicate-dispatch guard. Unique per company: two tills racing the same KOT
  -- batch produce the same key, so only the first INSERT wins.
  dedupe_key    TEXT         NOT NULL,
  -- PENDING | CLAIMED | SENT | CONFIRMED | FAILED | UNKNOWN | UNROUTED
  status        TEXT         NOT NULL DEFAULT 'PENDING',
  is_reprint    BOOLEAN      NOT NULL DEFAULT FALSE,
  attempts      INTEGER      NOT NULL DEFAULT 0,
  claimed_by    TEXT,
  claimed_at    TIMESTAMPTZ,
  last_error    TEXT         NOT NULL DEFAULT '',
  payload       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_by    BIGINT,
  created_on    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  modified_on   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT print_job_dedupe_uq UNIQUE (company_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS print_job_station_status_idx
  ON ops.print_job (company_id, station_id, status);
CREATE INDEX IF NOT EXISTS print_job_kot_idx
  ON ops.print_job (company_id, kot_master_id);
