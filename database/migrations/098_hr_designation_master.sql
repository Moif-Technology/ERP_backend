-- 098_hr_designation_master.sql  Designation master for HR / Staff entry
-- Run on both local and production DB.

CREATE TABLE IF NOT EXISTS hr.designation_master (
  company_id        INTEGER      NOT NULL,
  branch_id         INTEGER      NOT NULL,
  designation_id    INTEGER      NOT NULL,
  designation_name  VARCHAR(80)  NOT NULL,
  PRIMARY KEY (company_id, branch_id, designation_id)
);

-- Seed every existing branch with the designations that were previously
-- hardcoded in the frontend (ERP_frontend/src/shared/constants/designationOptions.js),
-- so the Staff Entry dropdown keeps working unchanged after the switch to DB-driven data.
INSERT INTO hr.designation_master (company_id, branch_id, designation_id, designation_name)
SELECT b.company_id, b.branch_id,
       ROW_NUMBER() OVER (PARTITION BY b.company_id, b.branch_id ORDER BY d.ord),
       d.designation_name
FROM core.branch_master b
CROSS JOIN (VALUES
  ('Chief Executive Officer / Owner', 1),
  ('General Manager', 2),
  ('Operations Manager', 3),
  ('Sales Manager', 4),
  ('Purchase Manager', 5),
  ('Finance Manager', 6),
  ('IT Manager', 7),
  ('HR Manager', 8),
  ('Sales Team Lead', 9),
  ('Manager', 10),
  ('Accountant', 11),
  ('Cashier', 12),
  ('Sales Executive', 13),
  ('Warehouse', 14),
  ('Other', 15)
) AS d(designation_name, ord)
ON CONFLICT (company_id, branch_id, designation_id) DO NOTHING;
