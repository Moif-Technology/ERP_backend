-- 131_active_session_device.sql
-- Bind a staff's POS session to the terminal that opened it, so the same staff
-- can't be signed in on two Counter-POS terminals at once.
--   session_id   = JWT `jti`; authMiddleware rejects tokens whose jti no longer
--                  matches (the session was taken over by another terminal).
--   device_token / station_id = which terminal + counter holds the session.
-- NULL for ERP and older POS logins → behaviour unchanged for them.

ALTER TABLE core.active_session
  ADD COLUMN IF NOT EXISTS session_id   VARCHAR(64),
  ADD COLUMN IF NOT EXISTS device_token VARCHAR(128),
  ADD COLUMN IF NOT EXISTS station_id   BIGINT;
