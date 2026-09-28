-- Legacy KotMaster.DiscountType: 0 = bill discount, 2 = item-wise.
ALTER TABLE ops.kot_master
  ADD COLUMN IF NOT EXISTS discount_type INTEGER NOT NULL DEFAULT 0;

INSERT INTO core.parameter_definition (module, parameter_key, parameter_name, value_type, default_value, category, sort_order, is_active)
VALUES
  ('POS', 'discount_button_1', 'Discount Button 1 (%)', 'number', '5',  'BILLING', 12, true),
  ('POS', 'discount_button_2', 'Discount Button 2 (%)', 'number', '10', 'BILLING', 13, true),
  ('POS', 'discount_button_3', 'Discount Button 3 (%)', 'number', '15', 'BILLING', 14, true)
ON CONFLICT (module, parameter_key) DO NOTHING;
