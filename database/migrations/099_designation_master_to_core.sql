-- 099_designation_master_to_core.sql
-- Designation is core staff data (needed by every software type / plan),
-- not HR-specific. Move it out of the hr schema (which is gated behind the
-- HR pack entitlement and blocks standard/basic plans) into core, alongside
-- branch_master and role_master which Staff Entry already depends on.
-- Run on both local and production DB.

ALTER TABLE IF EXISTS hr.designation_master SET SCHEMA core;
