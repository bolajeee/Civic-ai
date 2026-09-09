CREATE TABLE gov_invite_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash   VARCHAR(255) UNIQUE NOT NULL,   -- SHA-256 of the raw invite code
  role        user_role NOT NULL DEFAULT 'OPERATOR',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  used_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  used_at     TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one use per code is enforced by used_by being set on redemption.
-- Index for fast look-up on registration
CREATE INDEX idx_gov_invite_codes_code_hash ON gov_invite_codes(code_hash);
