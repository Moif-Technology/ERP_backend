INSERT INTO core.parameter_definition (module, parameter_key, parameter_name, value_type, default_value, category, sort_order, is_active)
VALUES
  ('POS', 'is_credit_card_popup', 'Credit card type popup (IsCreditCardPopup)', 'number', '0', 'GENERAL', 12, true)
ON CONFLICT (module, parameter_key) DO NOTHING;
