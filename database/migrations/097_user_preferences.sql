-- Generic per-staff UI preference store (JSON blob keyed by an arbitrary pref_key),
-- e.g. hidden/optional fields on the Purchase line-entry form, saved column layouts, etc.

CREATE TABLE IF NOT EXISTS core.user_preferences (
  id          SERIAL       PRIMARY KEY,
  staff_id    INTEGER      NOT NULL,
  pref_key    VARCHAR(100) NOT NULL,
  pref_json   JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_preferences UNIQUE (staff_id, pref_key)
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_lookup
  ON core.user_preferences (staff_id, pref_key);
