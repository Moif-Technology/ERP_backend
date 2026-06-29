-- 094: email verification for self-registered company owners

-- Add column with DEFAULT true so ALL existing staff rows are immediately verified
-- (they pre-date this feature — don't lock them out).
ALTER TABLE core.staff_master
  ADD COLUMN IF NOT EXISTS email_verified       BOOLEAN      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_verify_token   VARCHAR(128),
  ADD COLUMN IF NOT EXISTS email_verify_expires TIMESTAMPTZ;

-- Change default to false so NEW registrations require verification.
ALTER TABLE core.staff_master ALTER COLUMN email_verified SET DEFAULT false;

-- Fast lookup by token when user clicks the verify link
CREATE INDEX IF NOT EXISTS idx_staff_master_verify_token
  ON core.staff_master (email_verify_token)
  WHERE email_verify_token IS NOT NULL;
