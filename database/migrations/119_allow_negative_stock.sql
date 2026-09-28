-- Restaurant POS settle deducts qty_on_hand. Menu items often start at 0,
-- so on-hand must be allowed to go negative (same idea as van negative stock).
ALTER TABLE core.product_inventory
  DROP CONSTRAINT IF EXISTS ck_product_inventory_qty_on_hand;
