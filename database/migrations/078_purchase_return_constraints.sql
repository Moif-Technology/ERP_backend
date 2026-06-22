-- Purchase returns use negative subtotal, VAT, O/S, and line qty.
-- Relax purchase_master / purchase_child checks for transaction_type = 'RETURN'.

ALTER TABLE ops.purchase_master DROP CONSTRAINT IF EXISTS ck_purchase_master_net_vat;
ALTER TABLE ops.purchase_master ADD CONSTRAINT ck_purchase_master_net_vat
  CHECK (
    net_vat >= 0
    OR UPPER(COALESCE(TRIM(transaction_type), '')) = 'RETURN'
  );

ALTER TABLE ops.purchase_master DROP CONSTRAINT IF EXISTS ck_purchase_master_subtotal_amount;
ALTER TABLE ops.purchase_master ADD CONSTRAINT ck_purchase_master_subtotal_amount
  CHECK (
    subtotal_amount >= 0
    OR UPPER(COALESCE(TRIM(transaction_type), '')) = 'RETURN'
  );

ALTER TABLE ops.purchase_master DROP CONSTRAINT IF EXISTS ck_purchase_master_outstanding_balance;
ALTER TABLE ops.purchase_master ADD CONSTRAINT ck_purchase_master_outstanding_balance
  CHECK (
    outstanding_balance >= 0
    OR UPPER(COALESCE(TRIM(transaction_type), '')) = 'RETURN'
  );

ALTER TABLE ops.purchase_master DROP CONSTRAINT IF EXISTS ck_purchase_master_discount_amount;
ALTER TABLE ops.purchase_master ADD CONSTRAINT ck_purchase_master_discount_amount
  CHECK (
    discount_amount >= 0
    OR UPPER(COALESCE(TRIM(transaction_type), '')) = 'RETURN'
  );

ALTER TABLE ops.purchase_child DROP CONSTRAINT IF EXISTS ck_purchase_child_qty;
-- Negative qty allowed for return lines; purchase entry validates positive qty in app.
