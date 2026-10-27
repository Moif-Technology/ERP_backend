-- Barcode must identify exactly one active product per company (case-insensitive).
-- The API already enforces this (product.service assertBarcodesUnique); this adds the
-- DB guarantee. Existing data may hold duplicates, so the index is only created when
-- none exist — otherwise a NOTICE is raised and nothing changes. Clean duplicates via
-- Tools > Duplicate barcodes, then re-run. Re-run safe.
-- Scope matches the app check: master barcode, ACTIVE rows, non-empty.
-- (Pack-line barcodes live in core.product_pack_line and stay app-enforced.)
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'core' AND indexname = 'uq_core_product_master_company_barcode_ci'
  ) THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT company_id, LOWER(BTRIM(barcode))
    FROM core.product_master
    WHERE record_status = 'ACTIVE' AND barcode IS NOT NULL AND BTRIM(barcode) <> ''
    GROUP BY company_id, LOWER(BTRIM(barcode))
    HAVING COUNT(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE NOTICE 'Skipped uq_core_product_master_company_barcode_ci: % duplicate barcode group(s) exist. Resolve them and re-run 133.', dup_count;
    RETURN;
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS uq_core_product_master_company_barcode_ci
    ON core.product_master (company_id, LOWER(BTRIM(barcode)))
    WHERE record_status = 'ACTIVE' AND barcode IS NOT NULL AND BTRIM(barcode) <> '';
END $$;
