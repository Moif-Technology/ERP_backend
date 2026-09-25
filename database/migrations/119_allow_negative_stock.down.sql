ALTER TABLE core.product_inventory
  DROP CONSTRAINT IF EXISTS ck_product_inventory_qty_on_hand;

ALTER TABLE core.product_inventory
  ADD CONSTRAINT ck_product_inventory_qty_on_hand
  CHECK (qty_on_hand >= 0);
