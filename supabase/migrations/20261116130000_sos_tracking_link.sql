-- Live tracking link for SOS alerts. The first alert text (sent from the
-- citizen's own phone when the server has no SMS provider) carries
-- https://<api>/t/<share_token>; anyone with the link sees the latest reported
-- position until the alert ends. 128 random bits, so it cannot be guessed.
-- Nullable: alerts raised before this migration have no link.
ALTER TABLE sos_alerts ADD COLUMN share_token TEXT UNIQUE
  CHECK (share_token ~ '^[A-Za-z0-9_-]{22}$');
