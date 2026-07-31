-- Migration 108: Add pack metadata table for module customization
-- Purpose: Store display metadata (icon, color, name) for module packs
-- Allows admins to customize module appearance without code changes

CREATE TABLE IF NOT EXISTS core.pack_metadata (
  pack_code VARCHAR(50) PRIMARY KEY,
  -- Display name for the module (e.g., "Point of Sale", "Human Resources")
  metadata JSONB NOT NULL DEFAULT '{
    "name": null,
    "icon": "📦",
    "color": "#6b7280",
    "description": null,
    "order": 100
  }'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE core.pack_metadata IS
'Metadata for module packs (icon, color, name). Allows customizing module display dynamically. Queried by getModuleDefinitions() to build UI module definitions.';

COMMENT ON COLUMN core.pack_metadata.metadata IS
'JSONB object with keys: name (string), icon (emoji), color (hex), description (string), order (int). Example: {"name":"Point of Sale","icon":"💳","color":"#be185d","order":2}';

-- Insert defaults for built-in packs
INSERT INTO core.pack_metadata (pack_code, metadata) VALUES
('core', '{"name":"Core System","icon":"⚙️","color":"#0369a1","order":1}'::jsonb),
('backoffice', '{"name":"Backoffice","icon":"📊","color":"#b45309","order":2}'::jsonb),
('pos', '{"name":"POS","icon":"💳","color":"#be185d","order":3}'::jsonb),
('accounts', '{"name":"Accounts","icon":"📋","color":"#1e40af","order":4}'::jsonb),
('hr', '{"name":"Human Resources","icon":"👥","color":"#0f766e","order":5}'::jsonb),
('crm', '{"name":"CRM","icon":"📞","color":"#7c3aed","order":6}'::jsonb),
('garage', '{"name":"Garage Management","icon":"🔧","color":"#c2410c","order":7}'::jsonb),
('service', '{"name":"Service Management","icon":"🛠️","color":"#059669","order":8}'::jsonb),
('van', '{"name":"Van Sales","icon":"🚐","color":"#e11d48","order":9}'::jsonb)
ON CONFLICT (pack_code) DO NOTHING;

-- Index for fast lookups during module definition building
CREATE INDEX IF NOT EXISTS idx_pack_metadata_code ON core.pack_metadata(pack_code);
