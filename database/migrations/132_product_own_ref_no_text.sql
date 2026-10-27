-- Own Ref No. is an alphanumeric code (e.g. MOH-06146), but the legacy column was
-- NUMERIC(18,0), so the API silently dropped anything non-numeric on save.
-- Existing numeric values convert losslessly. Re-run safe (no-op once varchar).
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'core' AND table_name = 'product_master' AND column_name = 'own_ref_no') = 'numeric' THEN
    ALTER TABLE core.product_master
      ALTER COLUMN own_ref_no TYPE VARCHAR(50) USING own_ref_no::text;
  END IF;
END $$;
