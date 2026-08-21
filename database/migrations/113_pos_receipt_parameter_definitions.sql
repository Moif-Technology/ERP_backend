-- POS receipt / counter headings + core POS settings used by Salon & Restaurant POS.
INSERT INTO core.parameter_definition (module, parameter_key, parameter_name, value_type, default_value, category, sort_order, is_active)
VALUES
  ('POS', 'tax1',                      'Tax 1 (%)',              'number', '5',   'BILLING',  1,  true),
  ('POS', 'currency_precision',        'Currency Precision',     'number', '2',   'BILLING',  2,  true),
  ('POS', 'report_start_time',         'Report Start Time',      'text',   '',    'REPORT',   3,  true),
  ('POS', 'report_end_time',           'Report End Time',        'text',   '',    'REPORT',   4,  true),
  ('POS', 'pending_kot_check',         'Pending KOT Check',      'number', '0',   'KOT',      5,  true),
  ('POS', 'is_waiter_mandatory',       'Waiter Mandatory',       'number', '0',   'KOT',      6,  true),
  ('POS', 'clear_after_kot_save',      'Clear After KOT Save',   'number', '0',   'KOT',      7,  true),
  ('POS', 'save_kot_on_settlement',    'Save KOT On Settlement', 'number', '0',   'KOT',      8,  true),
  ('POS', 'heading1_counter',          'Heading 1 (Shop Name)',  'text',   '',    'RECEIPT',  30, true),
  ('POS', 'heading2_counter',          'Heading 2',              'text',   '',    'RECEIPT',  31, true),
  ('POS', 'heading3_counter',          'Heading 3',              'text',   '',    'RECEIPT',  32, true),
  ('POS', 'heading4_counter',          'Heading 4',              'text',   '',    'RECEIPT',  33, true),
  ('POS', 'heading5_counter',          'Heading 5',              'text',   '',    'RECEIPT',  34, true),
  ('POS', 'heading6_counter',          'Footer 1',               'text',   '',    'RECEIPT',  35, true),
  ('POS', 'heading7_counter',          'Footer 2',               'text',   '',    'RECEIPT',  36, true),
  ('POS', 'tax_registration_no',       'Tax Registration No',    'text',   '',    'RECEIPT',  37, true)
ON CONFLICT (module, parameter_key) DO NOTHING;
