CREATE TYPE social_auth_provider AS ENUM ('google', 'apple');

CREATE TABLE social_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider social_auth_provider NOT NULL,
  provider_user_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_user_id),
  UNIQUE (user_id, provider)
);

CREATE INDEX idx_social_identities_user_id ON social_identities(user_id);

CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts SMALLINT NOT NULL DEFAULT 0,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_password_reset_tokens_user_id_created_at
  ON password_reset_tokens(user_id, created_at DESC);

CREATE INDEX idx_password_reset_tokens_expires_at
  ON password_reset_tokens(expires_at);
