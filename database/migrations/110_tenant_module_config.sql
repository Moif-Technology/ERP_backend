-- Tenant module configuration: control which modules are enabled per tenant
-- This is the source of truth for what features each tenant can access

CREATE TABLE IF NOT EXISTS core.tenant_module_config (
  tenant_module_config_id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  module_code VARCHAR(50) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(100),
  updated_by VARCHAR(100),
  FOREIGN KEY (company_id) REFERENCES core.company_master(company_id),
  UNIQUE(company_id, module_code)
);

-- Seed: All modules enabled by default for all existing companies
INSERT INTO core.tenant_module_config (company_id, module_code, is_enabled, created_by)
SELECT DISTINCT c.company_id, m.module_code, true, 'system_migration'
FROM core.company_master c
CROSS JOIN (
  SELECT DISTINCT 'core' AS module_code
  UNION ALL SELECT 'backoffice'
  UNION ALL SELECT 'pos'
  UNION ALL SELECT 'accounts'
  UNION ALL SELECT 'hr'
  UNION ALL SELECT 'crm'
  UNION ALL SELECT 'garage'
  UNION ALL SELECT 'service'
  UNION ALL SELECT 'van'
) m
WHERE NOT EXISTS (
  SELECT 1 FROM core.tenant_module_config tmc
  WHERE tmc.company_id = c.company_id
  AND tmc.module_code = m.module_code
)
ON CONFLICT (company_id, module_code) DO NOTHING;

CREATE INDEX idx_tenant_module_config_company ON core.tenant_module_config(company_id);
CREATE INDEX idx_tenant_module_config_module ON core.tenant_module_config(module_code);
