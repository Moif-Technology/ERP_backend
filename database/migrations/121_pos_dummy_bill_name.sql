-- ParameterTableCounter DummyBillName — title printed on the dummy bill.
INSERT INTO core.parameter_definition (module, parameter_key, parameter_name, value_type, default_value, category, sort_order, is_active)
VALUES
  ('POS', 'dummy_bill_name', 'Dummy Bill Name', 'text', '', 'RECEIPT', 38, true)
ON CONFLICT (module, parameter_key) DO NOTHING;
