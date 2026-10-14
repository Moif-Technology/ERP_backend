-- Two delivery boys per company (Mainfrm designation DELIVERY BOY).
-- No PIN, so they do not appear on the POS login picker.
INSERT INTO core.staff_master (
  company_id, staff_id, branch_id, staff_code, staff_name, designation,
  login_name, password_hash, record_status, sync_status, created_at, created_by
)
SELECT c.company_id,
       c.next_id,
       c.branch_id,
       'DB-AHMED',
       'Ahmed',
       'DELIVERY BOY',
       'db.ahmed.' || c.company_id::text,
       'disabled',
       'ACTIVE',
       'PENDING',
       NOW(),
       'seed'
FROM (
  SELECT company_id,
         MIN(branch_id) AS branch_id,
         COALESCE(MAX(staff_id), 0) + 1 AS next_id
  FROM core.staff_master
  GROUP BY company_id
) c
WHERE NOT EXISTS (
  SELECT 1 FROM core.staff_master s
  WHERE s.company_id = c.company_id
    AND s.staff_code = 'DB-AHMED'
);

INSERT INTO core.staff_master (
  company_id, staff_id, branch_id, staff_code, staff_name, designation,
  login_name, password_hash, record_status, sync_status, created_at, created_by
)
SELECT c.company_id,
       c.next_id,
       c.branch_id,
       'DB-HASSAN',
       'Hassan',
       'DELIVERY BOY',
       'db.hassan.' || c.company_id::text,
       'disabled',
       'ACTIVE',
       'PENDING',
       NOW(),
       'seed'
FROM (
  SELECT company_id,
         MIN(branch_id) AS branch_id,
         COALESCE(MAX(staff_id), 0) + 1 AS next_id
  FROM core.staff_master
  GROUP BY company_id
) c
WHERE NOT EXISTS (
  SELECT 1 FROM core.staff_master s
  WHERE s.company_id = c.company_id
    AND s.staff_code = 'DB-HASSAN'
);
