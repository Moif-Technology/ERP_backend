INSERT INTO core.parameter_definition (module, parameter_key, parameter_name, value_type, default_value, category, sort_order, is_active)
VALUES
  ('POS', 'is_table_popup',            'Table floor popup (IsTablePopup)', 'number', '0', 'KOT', 9,  true),
  ('POS', 'is_tables_based_on_waiter', 'Tables based on waiter',           'number', '0', 'KOT', 10, true),
  ('POS', 'default_area_name',         'Default area is Take Away (1)',    'number', '1', 'KOT', 11, true)
ON CONFLICT (module, parameter_key) DO NOTHING;
