ALTER TABLE ops.kot_master DROP COLUMN IF EXISTS discount_type;

DELETE FROM core.parameter_definition
 WHERE module = 'POS'
   AND parameter_key IN ('discount_button_1', 'discount_button_2', 'discount_button_3');
