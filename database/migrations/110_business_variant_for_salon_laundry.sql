-- 110_business_variant_for_salon_laundry.sql
-- Add business_variant column to allow Salon and Laundry to share same software type
-- but present different UI (logos, names, etc.)
-- Both use SALON software_type_id but variant determines presentation.

BEGIN;

ALTER TABLE core.company_master
ADD COLUMN business_variant VARCHAR(50) DEFAULT 'salon' CHECK (business_variant IN ('salon', 'laundry'));

COMMENT ON COLUMN core.company_master.business_variant IS
'Business variant for presentation. Both salon and laundry use same SALON software type; this determines UI/branding.';

-- Seed existing SALON companies with 'salon' variant (already default, but explicit)
UPDATE core.company_master
SET business_variant = 'salon'
WHERE software_type_id = (SELECT software_type_id FROM core.software_type_master WHERE software_code = 'SALON')
  AND business_variant IS NULL;

COMMIT;
