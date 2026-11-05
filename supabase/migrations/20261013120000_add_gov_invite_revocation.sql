ALTER TABLE gov_invite_codes
ADD COLUMN revoked_at TIMESTAMPTZ;

CREATE INDEX idx_gov_invite_codes_open
ON gov_invite_codes (expires_at)
WHERE used_by IS NULL AND revoked_at IS NULL;
