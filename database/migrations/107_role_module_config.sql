-- Migration 107: Add role module configuration table
-- Purpose: Store module and feature enablement per role
-- Allows fine-grained control over which modules/components are available to each role

-- Create role_module_config table to store module-level feature configuration
CREATE TABLE IF NOT EXISTS core.role_module_config (
  role_module_config_id BIGSERIAL PRIMARY KEY,
  company_id INT NOT NULL,
  role_id INT NOT NULL,
  module_code VARCHAR(50) NOT NULL,
  -- When NULL: all features in module are enabled for this role
  -- When JSON object: specific features enabled/disabled per role
  -- Example: {"backoffice.sales": true, "backoffice.inventory": false}
  feature_config JSONB DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (company_id, role_id, module_code),
  FOREIGN KEY (company_id) REFERENCES backoffice.company_master(company_id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, role_id) REFERENCES core.role_master(company_id, role_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_role_module_config_company_role
  ON core.role_module_config(company_id, role_id);

COMMENT ON TABLE core.role_module_config IS
'Module and feature configuration per role. Controls which modules are available and which features within each module are enabled for a specific role. Complements role_permission for feature-level access control.';

COMMENT ON COLUMN core.role_module_config.feature_config IS
'JSONB object mapping feature codes to boolean enabled status. NULL means all features enabled. Example: {"pos.settlement": true, "pos.hold_bill": false}';
