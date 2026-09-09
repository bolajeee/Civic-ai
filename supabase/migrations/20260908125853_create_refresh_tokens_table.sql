CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) UNIQUE NOT NULL,   -- SHA-256 of the raw token
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast look-ups by user (e.g. "revoke all sessions for user X")
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);

-- Automatically purge expired / revoked tokens older than 30 days
-- (run via a cron job or Supabase scheduled function)
-- This index helps that cleanup query:
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
