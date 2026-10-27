-- Price levels are VAT-inclusive (POS applies them per area: area_master.price_level).
-- product.service used to default price_level_1 to unit_price (ex-VAT) when left blank,
-- so every product looked like it had a Level 1 price — cheaper than normal by the VAT.
-- Those auto-copies are reset to 0 = "not set" → POS falls back to normal price.
-- Re-runnable.
UPDATE core.product_inventory
   SET price_level_1 = 0
 WHERE price_level_1 <> 0
   AND price_level_1 = unit_price;
