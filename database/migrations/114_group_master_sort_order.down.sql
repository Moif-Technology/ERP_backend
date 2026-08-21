DROP INDEX IF EXISTS biz.idx_biz_group_master_company_branch_sort;

ALTER TABLE biz.group_master
  DROP COLUMN IF EXISTS sort_order;
