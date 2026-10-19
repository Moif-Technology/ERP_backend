-- VAT registration lives on the tenant row (core.company_master) so backoffice
-- (Company Profile) and POS (Control Panel → Tax Settings) read/write ONE place.
-- Before this, POS kept its own vat_enabled / tax_registration_no inside
-- core.company_parameter_value (module 'POS') and never saw company_master.vat_trn.
-- Re-runnable.
BEGIN;

ALTER TABLE core.company_master
  ADD COLUMN IF NOT EXISTS vat_trn     TEXT,
  ADD COLUMN IF NOT EXISTS vat_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Carry over a TRN that was only ever typed into the POS.
UPDATE core.company_master cm
   SET vat_trn = NULLIF(TRIM(pv.settings->>'tax_registration_no'), '')
  FROM core.company_parameter_value pv
 WHERE pv.company_id = cm.company_id AND pv.module = 'POS'
   AND COALESCE(TRIM(cm.vat_trn), '') = ''
   AND COALESCE(TRIM(pv.settings->>'tax_registration_no'), '') <> '';

-- On if POS had it switched on, or (never set) if a TRN exists — same fallback POS used.
UPDATE core.company_master cm
   SET vat_enabled = COALESCE(
         (SELECT (pv.settings->>'vat_enabled') = '1'
            FROM core.company_parameter_value pv
           WHERE pv.company_id = cm.company_id AND pv.module = 'POS'
             AND pv.settings ? 'vat_enabled'),
         COALESCE(TRIM(cm.vat_trn), '') <> '');

COMMIT;
