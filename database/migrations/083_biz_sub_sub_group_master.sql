-- Migration 083: Add missing columns to biz.sub_sub_group_master
-- Table already exists from legacy schema (no branch_id, group_id, or Arabic description).
-- This migration adds the columns needed for branch/group scoping and Arabic support.

ALTER TABLE biz.sub_sub_group_master
  ADD COLUMN IF NOT EXISTS branch_id INTEGER,
  ADD COLUMN IF NOT EXISTS group_id  INTEGER,
  ADD COLUMN IF NOT EXISTS sub_sub_group_description_arabic TEXT;
