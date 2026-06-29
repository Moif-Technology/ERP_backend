-- 093: concurrent session tracking, plan session limits, auth event log

-- Active session registry — one row per staff per session type.
-- Upserted on login, deleted on logout, cleaned up by expires_at.
CREATE TABLE IF NOT EXISTS core.active_session (
  staff_pk      BIGINT       NOT NULL,
  company_id    BIGINT       NOT NULL,
  session_type  VARCHAR(10)  NOT NULL CHECK (session_type IN ('erp', 'pos')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ  NOT NULL,
  PRIMARY KEY (staff_pk, session_type)
);
CREATE INDEX IF NOT EXISTS idx_active_session_company_type
  ON core.active_session (company_id, session_type, expires_at);

-- Auth event log — login, logout, failures, limit violations.
CREATE TABLE IF NOT EXISTS core.auth_event_log (
  id           BIGSERIAL    PRIMARY KEY,
  company_id   BIGINT,
  staff_pk     BIGINT,
  event_type   VARCHAR(40)  NOT NULL,
  ip_address   VARCHAR(45),
  metadata     JSONB,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_event_log_company
  ON core.auth_event_log (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_event_log_staff
  ON core.auth_event_log (staff_pk, created_at DESC);

-- New limit codes for concurrent sessions
INSERT INTO core.limit_master (limit_code, limit_name, description, unit, sort_order)
VALUES
  ('max_erp_sessions', 'Max ERP Sessions', 'Concurrent ERP staff logins allowed', 'count', 25),
  ('max_pos_sessions', 'Max POS Sessions', 'Concurrent POS terminal sessions allowed', 'count', 32)
ON CONFLICT (limit_code) DO UPDATE SET
  limit_name  = EXCLUDED.limit_name,
  description = EXCLUDED.description,
  updated_at  = NOW();

-- Plan defaults for concurrent sessions
INSERT INTO core.plan_limit (plan_code, limit_code, limit_value)
VALUES
  ('basic',    'max_erp_sessions', 3),
  ('basic',    'max_pos_sessions', 1),
  ('standard', 'max_erp_sessions', 10),
  ('standard', 'max_pos_sessions', 3),
  ('pro',      'max_erp_sessions', 30),
  ('pro',      'max_pos_sessions', 10),
  ('custom',   'max_erp_sessions', 999),
  ('custom',   'max_pos_sessions', 999)
ON CONFLICT (plan_code, limit_code) DO UPDATE SET limit_value = EXCLUDED.limit_value;
