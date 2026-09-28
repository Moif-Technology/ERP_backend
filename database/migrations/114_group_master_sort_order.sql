-- Display order for POS / counter group tiles (desktop-shortcut style arrange).
-- Backfills existing rows by group_code so current order is preserved as a starting point.

ALTER TABLE biz.group_master
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

WITH ordered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY company_id, COALESCE(branch_id, 0)
      ORDER BY
        CASE WHEN COALESCE(sort_order, 0) = 0 THEN 1 ELSE 0 END,
        sort_order ASC,
        group_code ASC NULLS LAST,
        group_id ASC
    ) AS rn
  FROM biz.group_master
)
UPDATE biz.group_master g
SET sort_order = o.rn
FROM ordered o
WHERE g.id = o.id
  AND COALESCE(g.sort_order, 0) = 0;

CREATE INDEX IF NOT EXISTS idx_biz_group_master_company_branch_sort
  ON biz.group_master (company_id, branch_id, sort_order);
