-- 103: service.case_master.customer_id must store the company-scoped
-- biz.customer_master.customer_id (business id), not the internal id PK.
-- Every existing frontend consumer (CustomerPicker, customerEntry.api,
-- CRM's biz.lead_master.customer_id) already works this way — customer_id is
-- app-validated, not DB-FK-enforced, everywhere else in the codebase. Migration
-- 102 wrongly FK'd it to the internal id. Drop that constraint to match.
-- Run on both local and production DB.

ALTER TABLE service.case_master
  DROP CONSTRAINT IF EXISTS case_master_customer_id_fkey;
