-- Add customer display and auto round-off toggles to POS parameter definitions
INSERT INTO core.parameter_definition (module, parameter_key, parameter_name, value_type, default_value, category, sort_order, is_active)
VALUES
  ('POS', 'customer_display_enabled', 'Customer Display',  'number', '0', 'DISPLAY',  10, true),
  ('POS', 'auto_round_off',           'Auto Round-Off',    'number', '0', 'BILLING',  20, true)
ON CONFLICT (module, parameter_key) DO NOTHING;
