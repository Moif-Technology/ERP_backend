CREATE SCHEMA IF NOT EXISTS core;

CREATE TABLE IF NOT EXISTS core.tool_job_history (
  job_id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL,
  branch_id BIGINT NULL,
  job_type VARCHAR(30) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  file_name VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
  total_rows INTEGER NOT NULL DEFAULT 0,
  success_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  error_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tool_job_history_company_created
  ON core.tool_job_history (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS core.tool_audit_log (
  audit_id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL,
  branch_id BIGINT NULL,
  actor VARCHAR(100) NULL,
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id VARCHAR(100) NULL,
  summary VARCHAR(500) NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tool_audit_company_created
  ON core.tool_audit_log (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS core.tool_system_log (
  log_id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL,
  branch_id BIGINT NULL,
  level VARCHAR(20) NOT NULL DEFAULT 'INFO',
  source VARCHAR(60) NOT NULL DEFAULT 'TOOLS',
  message VARCHAR(500) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE core.tool_system_log
  ADD COLUMN IF NOT EXISTS actor VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS action VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS entity_type VARCHAR(80) NULL,
  ADD COLUMN IF NOT EXISTS entity_id VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS http_method VARCHAR(10) NULL,
  ADD COLUMN IF NOT EXISTS request_path VARCHAR(300) NULL,
  ADD COLUMN IF NOT EXISTS status_code INTEGER NULL,
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER NULL,
  ADD COLUMN IF NOT EXISTS ip_address VARCHAR(80) NULL,
  ADD COLUMN IF NOT EXISTS user_agent VARCHAR(500) NULL;

CREATE INDEX IF NOT EXISTS idx_tool_system_log_company_created
  ON core.tool_system_log (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_system_log_company_action
  ON core.tool_system_log (company_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_system_log_company_source
  ON core.tool_system_log (company_id, source, created_at DESC);

CREATE TABLE IF NOT EXISTS core.platform_system_log (
  log_id BIGSERIAL PRIMARY KEY,
  platform_user_id BIGINT NULL,
  actor VARCHAR(150) NULL,
  level VARCHAR(20) NOT NULL DEFAULT 'INFO',
  source VARCHAR(60) NOT NULL DEFAULT 'SUPER_ADMIN',
  action VARCHAR(50) NULL,
  entity_type VARCHAR(80) NULL,
  entity_id VARCHAR(120) NULL,
  message VARCHAR(500) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  http_method VARCHAR(10) NULL,
  request_path VARCHAR(300) NULL,
  status_code INTEGER NULL,
  duration_ms INTEGER NULL,
  ip_address VARCHAR(80) NULL,
  user_agent VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_platform_system_log_created
  ON core.platform_system_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_system_log_actor
  ON core.platform_system_log (platform_user_id, created_at DESC);
